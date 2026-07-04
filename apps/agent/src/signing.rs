//! Command signature verification.
//!
//! Ports `packages/shared/src/canonical.ts` and `packages/security/src/signing.ts`:
//! the control plane signs `HMAC-SHA256(canonicalJson({id,nodeId,payload,timeoutMs,
//! issuedAt}))` using the per-node key, where the key is the **hex-decoded bytes**
//! of `commandVerifyKey` (`Buffer.from(hexKey, 'hex')` on the API side).
//!
//! To guarantee byte-identical canonicalization with the signer, we canonicalize
//! the *raw* JSON value received from the wire rather than re-serializing our
//! typed structs (which could differ in field defaults or ordering).

use hmac::{Hmac, Mac};
use serde_json::{Map, Value};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Recursively sort object keys and serialize with no whitespace — the exact
/// algorithm of `canonicalJson` in the shared package.
pub fn canonical_json(value: &Value) -> String {
    let sorted = sort_value(value);
    // serde_json's compact serializer emits no whitespace, matching JSON.stringify.
    serde_json::to_string(&sorted).unwrap_or_default()
}

fn sort_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sort_value).collect()),
        Value::Object(obj) => {
            // BTree-like ordering: collect keys, sort lexicographically (matching
            // JS `Array.prototype.sort` default, i.e. UTF-16 code-unit order for the
            // ASCII key names used in the protocol).
            let mut keys: Vec<&String> = obj.keys().collect();
            keys.sort();
            let mut sorted = Map::with_capacity(obj.len());
            for key in keys {
                sorted.insert(key.clone(), sort_value(&obj[key]));
            }
            Value::Object(sorted)
        }
        other => other.clone(),
    }
}

/// Build the signable envelope `{id,nodeId,payload,timeoutMs,issuedAt}` from the
/// raw command JSON, preserving the exact `payload` bytes/shape as received.
fn signable_from_raw(raw: &Value) -> Option<Value> {
    let obj = raw.as_object()?;
    let mut map = Map::new();
    map.insert("id".into(), obj.get("id")?.clone());
    map.insert("nodeId".into(), obj.get("nodeId")?.clone());
    map.insert("payload".into(), obj.get("payload")?.clone());
    map.insert("timeoutMs".into(), obj.get("timeoutMs")?.clone());
    map.insert("issuedAt".into(), obj.get("issuedAt")?.clone());
    Some(Value::Object(map))
}

#[derive(Debug, thiserror::Error)]
pub enum SignatureError {
    #[error("command JSON missing required signing fields")]
    MalformedCommand,
    #[error("commandVerifyKey is not valid hex")]
    BadKey,
    #[error("signature is not valid hex")]
    BadSignature,
    #[error("signature mismatch — command rejected")]
    Mismatch,
}

/// Verify the HMAC signature of a raw command envelope against `hex_key`.
///
/// Returns `Ok(())` only when the signature matches. Uses the constant-time
/// comparison built into the `hmac` crate's `verify_slice`.
pub fn verify_command(raw: &Value, hex_key: &str) -> Result<(), SignatureError> {
    let signable = signable_from_raw(raw).ok_or(SignatureError::MalformedCommand)?;
    let signature_hex = raw
        .get("signature")
        .and_then(|s| s.as_str())
        .ok_or(SignatureError::MalformedCommand)?;

    let key = hex::decode(hex_key).map_err(|_| SignatureError::BadKey)?;
    let signature = hex::decode(signature_hex).map_err(|_| SignatureError::BadSignature)?;

    let message = canonical_json(&signable);
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| SignatureError::BadKey)?;
    mac.update(message.as_bytes());
    mac.verify_slice(&signature)
        .map_err(|_| SignatureError::Mismatch)
}

/// Compute the hex HMAC of an already-canonicalized message. This is the signer
/// side of the protocol; the agent only ever verifies, so it is used by tests and
/// kept public for symmetry / tooling.
#[allow(dead_code)]
pub fn sign_canonical(message: &str, hex_key: &str) -> Result<String, SignatureError> {
    let key = hex::decode(hex_key).map_err(|_| SignatureError::BadKey)?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| SignatureError::BadKey)?;
    mac.update(message.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_sorts_keys_recursively_without_whitespace() {
        let v = json!({
            "b": 1,
            "a": { "z": [3, 2, 1], "y": "x" },
        });
        // Keys sorted: a before b; within a, y before z. No spaces.
        assert_eq!(canonical_json(&v), r#"{"a":{"y":"x","z":[3,2,1]},"b":1}"#);
    }

    #[test]
    fn canonical_matches_known_string_for_command_envelope() {
        // Mirrors the fields the API signs. Order of insertion here is deliberately
        // scrambled to prove sorting is what matters.
        let raw = json!({
            "signature": "ignored",
            "timeoutMs": 300000,
            "id": "cmd_123",
            "issuedAt": "2026-07-04T00:00:00.000Z",
            "nodeId": "node_abc",
            "payload": { "type": "RESTART_APP", "spec": { "containerName": "c", "appId": "a" } },
        });
        let signable = signable_from_raw(&raw).unwrap();
        let canon = canonical_json(&signable);
        assert_eq!(
            canon,
            r#"{"id":"cmd_123","issuedAt":"2026-07-04T00:00:00.000Z","nodeId":"node_abc","payload":{"spec":{"appId":"a","containerName":"c"},"type":"RESTART_APP"},"timeoutMs":300000}"#
        );
    }

    #[test]
    fn verify_accepts_matching_signature_and_rejects_tampering() {
        // Self-consistent vector: sign with the same algorithm, then verify.
        // Key is hex (as delivered in commandVerifyKey). 32 bytes -> 64 hex chars.
        let hex_key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
        let raw_unsigned = json!({
            "id": "cmd_1",
            "nodeId": "node_1",
            "payload": { "type": "STOP_APP", "spec": { "appId": "a", "containerName": "c", "timeoutSeconds": 10 } },
            "timeoutMs": 60000,
            "issuedAt": "2026-01-01T00:00:00.000Z",
        });
        let signable = signable_from_raw(&raw_unsigned).unwrap();
        let sig = sign_canonical(&canonical_json(&signable), hex_key).unwrap();

        let mut signed = raw_unsigned.clone();
        signed
            .as_object_mut()
            .unwrap()
            .insert("signature".into(), json!(sig));
        assert!(verify_command(&signed, hex_key).is_ok());

        // Tamper with the payload -> signature must fail.
        let mut tampered = signed.clone();
        tampered["payload"]["spec"]["containerName"] = json!("evil");
        assert!(matches!(
            verify_command(&tampered, hex_key),
            Err(SignatureError::Mismatch)
        ));

        // Wrong key -> fail.
        let other_key = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
        assert!(matches!(
            verify_command(&signed, other_key),
            Err(SignatureError::Mismatch)
        ));
    }

    /// Cross-language golden vector: this exact key, canonical payload, and
    /// signature were produced by the LIVE TypeScript control plane (@yourstack/
    /// security `signCommand`) for a real DEPLOY_APP command. If this passes, the
    /// Rust canonicalization + HMAC is byte-compatible with the signer.
    #[test]
    fn verify_accepts_real_control_plane_signature() {
        let hex_key = "309a3730859566ac50c2338a177ef8341fbc6ebb147626f09e3266433dc1ab89";
        let signature = "31e30857a35631c056f3dacaa104fb81742f167dca89274a90ca4753dfedded4";
        // The canonical (sorted) signable envelope emitted by the API.
        let canonical = r#"{"id":"cmr6b26m6000niugpcqje4q8e","issuedAt":"2026-07-04T11:55:07.900Z","nodeId":"cmr6b268t000gej6pow7g70u5","payload":{"spec":{"appId":"cmr6b26d1000qej6psa84r1yv","containerName":"yourstack-cmr6b26d1000qej6psa84r1yv","deploymentId":"cmr6b26fl0011ej6py2awlm8o","env":{"API_KEY":"super-secret-value-123","NODE_ENV":"production","PORT":"80"},"healthcheck":{"expectStatus":200,"intervalMs":3000,"path":"/","port":80,"retries":5,"timeoutMs":10000},"imageTag":"yourstack/cmr6b26d1000qej6psa84r1yv:1","labels":{"io.yourstack.app":"cmr6b26d1000qej6psa84r1yv","io.yourstack.deployment":"cmr6b26fl0011ej6py2awlm8o","io.yourstack.managed":"true","io.yourstack.version":"1"},"networkName":"yourstack_cmr6b26d1000qej6psa84r1yv","ports":[{"containerPort":80,"protocol":"tcp"}],"resources":{"cpu":0.5,"memoryMb":512},"source":{"image":"traefik/whoami:latest","kind":"image"},"strategy":"basic_replace"},"type":"DEPLOY_APP"},"timeoutMs":900000}"#;

        // Re-canonicalizing the already-sorted JSON must be a no-op (idempotent).
        let parsed: Value = serde_json::from_str(canonical).unwrap();
        assert_eq!(canonical_json(&parsed), canonical);

        // Build the wire envelope (payload order scrambled by parse is fine — verify
        // re-canonicalizes) and attach the real signature.
        let mut envelope = parsed;
        envelope
            .as_object_mut()
            .unwrap()
            .insert("signature".into(), json!(signature));

        verify_command(&envelope, hex_key).expect("real control-plane signature must verify");

        // And the wrong key is still rejected.
        let bad = "0000000000000000000000000000000000000000000000000000000000000000";
        assert!(verify_command(&envelope, bad).is_err());
    }
}
