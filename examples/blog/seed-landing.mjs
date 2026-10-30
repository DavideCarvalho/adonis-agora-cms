/**
 * Seeds the demo landing page.
 *
 * Idempotent: re-running updates the same page (slug `landing`) instead of creating duplicates.
 * Usage: `node seed-landing.mjs` with the example app on :5611 (or `CMS_URL=... node seed-landing.mjs`).
 */
const base = process.env.CMS_URL ?? 'http://127.0.0.1:5611';

const landing = {
  title: 'Landing',
  visibility: 'public',
  layout: [
    {
      type: 'hero',
      eyebrow: 'Adonis CMS · Agora',
      heading: 'Conteúdo em produção sem deploy',
      subheading:
        'Um CMS config-first para AdonisJS: as collections são código, o painel nasce do schema e a API é REST. Você descreve o conteúdo, o CMS cuida do banco, das versões e do rascunho.',
      ctaLabel: 'Ver como funciona',
      ctaHref: '#features',
    },
    {
      type: 'features',
      heading: 'Por que config-first',
      intro:
        'Nada de migration escrita à mão, schema duplicado entre back e painel, ou um admin que precisa ser reescrito a cada campo novo.',
      items: [
        {
          title: 'Schema como código',
          text: 'Uma collection é um objeto TypeScript. Tipos, tabelas e validação saem da mesma fonte — sem codegen e sem divergência.',
        },
        {
          title: 'Painel que segue o schema',
          text: 'O admin lê /api/cms/schema e monta lista, formulário, relação, bloco e rich text. Campo novo, campo na tela.',
        },
        {
          title: 'Rascunho, versão e preview',
          text: 'Draft/publish, histórico restaurável e live preview com o campo certo em foco quando você clica na página.',
        },
      ],
    },
    {
      type: 'quote',
      quote:
        'Trocamos três semanas de scaffolding por uma tarde de configuração — e o painel continua igual quando o conteúdo muda.',
      attribution: 'Marina Alves · CTO na Palavra',
    },
    {
      type: 'text',
      heading: 'Como funciona',
      body: {
        tiptap: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Você declara a collection com os campos, o CMS compila o schema relacional, aplica no banco e expõe REST, Local API e painel. Arrays e blocos viram tabelas filhas, então filtrar por um campo dentro de um bloco é uma query normal.',
                },
              ],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'A página que você está lendo é um documento da collection "pages": cada seção é um bloco do layout, e o site mapeia slug → componente.',
                },
              ],
            },
          ],
        },
      },
    },
    {
      type: 'cta',
      heading: 'Coloque o CMS no ar hoje',
      text: 'Um comando para sincronizar o schema, um provider registrado e o painel está em /admin.',
      buttonLabel: 'Ler a documentação',
      buttonHref: '#',
    },
  ],
};

const existing = await fetch(`${base}/api/cms/collections/pages?where[slug][equals]=landing`);
const found = (await existing.json()).docs?.[0];

const response = await fetch(
  found ? `${base}/api/cms/collections/pages/${found.id}` : `${base}/api/cms/collections/pages`,
  {
    method: found ? 'PATCH' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(landing),
  },
);

if (!response.ok) {
  console.error('seed failed', response.status, await response.text());
  process.exit(1);
}

const doc = await response.json();
console.log(`${found ? 'updated' : 'created'} /p/${doc.slug} (${doc.id})`);
