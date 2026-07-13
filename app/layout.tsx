import "./globals.css";

export const metadata = {
  title: "Siconfi",
  description: "Comparador de arquivos CSV com mapeamentos configuraveis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
