/** โลโก้ TU vanwise: T แดง U เหลือง ตามสีธรรมศาสตร์ */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-tight ${className}`}>
      <span className="text-red">T</span>
      <span style={{ color: "var(--gold)" }}>U</span> vanwise
    </span>
  );
}
