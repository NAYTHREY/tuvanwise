import type { NextConfig } from "next";

// ส่งออกเป็นเว็บแบบ static (โฟลเดอร์ out/) เปิดได้บนโฮสติ้งทั่วไป ไม่ต้องมีเซิร์ฟเวอร์
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  assetPrefix: process.env.RELATIVE_ASSETS ? "./" : undefined,
};

export default nextConfig;
