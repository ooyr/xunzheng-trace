import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "循证 Trace · 让结论有迹可循",
  description: "像 Git 一样调查。拆解问题、分支核验、交叉比对，让每个结论都能找到来源。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
