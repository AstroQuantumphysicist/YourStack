import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ src, name, email, size = 32, className }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4) };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-gradient-to-br from-primary/30 to-accent/30 font-semibold text-foreground',
        className,
      )}
      style={style}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name, email)
      )}
    </span>
  );
}
