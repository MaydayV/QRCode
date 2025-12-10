import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '物料箱单标签生成器',
  description: 'Next.js 版物料箱单标签生成工具，服务端生成标签图',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
