"use client";

import { useEffect, useState } from "react";
import { UserApp } from "@/components/UserApp";
import { StaffApp } from "@/components/StaffApp";
import { Logo } from "@/components/Logo";

// หน้าเดียว: ผู้ใช้ทั่วไปเห็นหน้าหลัก ทีมงานเข้าทาง #staff (ไม่มีลิงก์บนหน้าผู้ใช้ และต้องใส่ PIN)
export default function Page() {
  const [view, setView] = useState<"loading" | "user" | "staff">("loading");
  useEffect(() => {
    const pick = () => setView(window.location.hash.startsWith("#staff") ? "staff" : "user");
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, []);

  if (view === "loading")
    return (
      <div className="mx-auto max-w-xl px-4 pt-6">
        <p className="text-[30px] leading-none">
          <Logo />
        </p>
      </div>
    );
  return view === "staff" ? <StaffApp /> : <UserApp />;
}
