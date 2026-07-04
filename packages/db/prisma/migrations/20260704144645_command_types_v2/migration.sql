-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommandType" ADD VALUE 'PROVISION_DATABASE';
ALTER TYPE "CommandType" ADD VALUE 'STOP_DATABASE';
ALTER TYPE "CommandType" ADD VALUE 'REMOVE_DATABASE';
ALTER TYPE "CommandType" ADD VALUE 'BACKUP_DATABASE';
ALTER TYPE "CommandType" ADD VALUE 'PROVISION_STORAGE';
ALTER TYPE "CommandType" ADD VALUE 'REMOVE_STORAGE';
ALTER TYPE "CommandType" ADD VALUE 'DEPLOY_FUNCTION';
ALTER TYPE "CommandType" ADD VALUE 'INVOKE_FUNCTION';
ALTER TYPE "CommandType" ADD VALUE 'REMOVE_FUNCTION';
ALTER TYPE "CommandType" ADD VALUE 'REGISTER_RUNNER';
ALTER TYPE "CommandType" ADD VALUE 'DEREGISTER_RUNNER';
ALTER TYPE "CommandType" ADD VALUE 'SCALE_APP';
