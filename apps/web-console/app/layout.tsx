import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SocialGrowth 运营工作台',
  description: 'SocialGrowth 首批业务闭环受控运营工作台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
