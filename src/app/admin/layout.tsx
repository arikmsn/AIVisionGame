import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Visual Benchmark Arena | Admin',
  description: 'Multi-model visual idiom benchmark — compare GPT-4o, Claude, Gemini, Llama and more.',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
