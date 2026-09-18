import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SocialGrowth Web 运营管理控制台 (前 3 个月成果基线)',
  description: 'SocialGrowth 统一现代 Web 运营管理控制台，7 大核心模块纯真机矩阵中枢'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
