# Runa — mesa de dados de RPG

Dados de RPG com física 3D, mesas online em tempo real e áreas separadas para mestre e jogadores.

- **Dados com física**: d2 (moeda), d4, d6, d8, d10, d12, d20 e d100 (dezena + unidade) são sólidos de verdade, jogados numa bandeja com física (three.js + cannon-es), com som de batida.
- **Dado rúnico (d24)**: icositetraedro deltoidal com as 24 runas do Futhark Antigo, separadas nos três ættir. Cada personagem pode escolher a própria runa; quando o dado mostra a runa do personagem ou outra do mesmo ætt, a rolagem ganha destaque. Os efeitos de cada runa no sistema de *Journey to Ragnarok* ficam no livro: o site mostra a runa, o ætt e um significado tradicional curto.
- **Dados novos**: crie dados com faces próprias (Sim/Não, clima, tabelas) ou com qualquer número de lados (d7, d30…). Se existir um sólido com aquela quantidade de faces (2, 3, 5, 6, 8, 10, 12, 20, 24), ele também é jogado em 3D; os outros aparecem como fichas animadas.
- **Notação**: `1d20+5`, `2d20kh1` (vantagem), `2d20kl1`, `4d6k3`, `4d6dl1`, `d%`, `3dF` (Fate), `1dR` (runa), `2d[Nome do dado]`, `1d{Sim,Não,Talvez}`.
- **Mesas online**: o mestre cria a campanha e manda o link/código; quem entra vê na hora as rolagens de todos (dados caindo na bandeja + histórico), quem está online e a cor de cada jogador. Dá para entrar como convidado só com um apelido.
- **Rolagens no servidor**: os resultados das mesas online são sorteados no banco (função `roll_dice`), então ninguém consegue forjar um 20. A física só anima o resultado: a bandeja escolhe a orientação do dado para que ele caia mostrando o valor sorteado.
- **Rolagem secreta**: o jogador pode rolar só para o mestre; o mestre pode rolar escondido dos jogadores.
- **Área do Mestre**: criar/editar/apagar campanhas e mesas avulsas, código de convite (e trocar o código), ver e remover jogadores, dados da mesa, limpar histórico.
- **Área do Jogador**: entrar por código, nome e anotações do personagem em cada mesa, runa, cor dos dados, sair da mesa, dados pessoais, transformar a conta de convidado em conta com usuário e senha.

A mesa solo (página inicial) funciona sem banco nenhum: as rolagens ficam no aparelho.

## Colocar no ar (Vercel + Supabase)

1. **Importe o repositório na Vercel**: *Add New → Project*, escolha o repositório e clique em *Deploy*. Sem banco, o site já sobe com a mesa solo.
2. **Conecte o Supabase**: no projeto da Vercel, aba **Storage → Create Database → Supabase** (Marketplace) e ligue ao projeto. A integração cria o banco e as variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `POSTGRES_URL*`.
3. **Publique de novo** (*Deployments → Redeploy*). O build roda `scripts/migrate.mjs`, que cria tabelas, regras de acesso (RLS), funções e o tempo real.
   - Se o log do build disser que não conseguiu conectar ao banco, abra o **SQL Editor** do Supabase, cole o conteúdo de `supabase/migrations/0001_runa.sql` e rode. O arquivo pode ser rodado mais de uma vez.
4. Abra o site, crie uma conta, vá em **Mestre → Nova campanha** e mande o link para o grupo.

Não precisa mexer em configurações de e-mail do Supabase: as contas usam **usuário e senha**, criadas já confirmadas pelo servidor, e nenhum e-mail é enviado.

### Usando um projeto Supabase criado fora da Vercel

Cadastre as variáveis na Vercel (*Settings → Environment Variables*), com os valores de *Project Settings → API* e *Database* do Supabase:

| Variável | Para quê |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública (anon / publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | chave de serviço (só no servidor: cria contas) |
| `POSTGRES_URL` | conexão do banco (pooler), para o build criar as tabelas |

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # opcional: sem Supabase só a mesa solo funciona
npm run dev
```

Testes:

```bash
npm test                      # notação, resumo das rolagens, geometria e simetrias dos dados
RUNA_TEST_DB=postgres://postgres@127.0.0.1:5432/runa_teste npm test   # + regras do banco (RLS, rolagens)
```

`tests/e2e/fake-supabase.mjs` é um substituto local do Supabase (autenticação, REST e tempo real) que roda a migração real num PostgreSQL comum, útil para testar as mesas online sem Docker. Ele imprime as chaves para colocar no `.env.local`.

## Como funciona

- `lib/dice/geometry.ts` — sólidos dos dados (faces encontradas pelos planos de apoio dos vértices), centros e orientação dos rótulos, e as rotações de simetria entre faces.
- `lib/dice/physics.ts` — joga os dados com cannon-es, grava a animação e repete o arremesso se algum dado parar inclinado.
- `lib/dice/tray.ts` e `lib/dice/mesh.ts` — bandeja em three.js: dados chanfrados, rótulos num atlas desenhado em canvas (runas desenhadas em traços), fila de arremessos e sons.
- `lib/dice/roll.ts` — liga o resultado sorteado ao arremesso: o dado é girado por uma simetria do sólido para que a face sorteada fique para cima.
- `supabase/migrations/0001_runa.sql` — tabelas, RLS, `roll_dice`, `join_mesa`, `create_mesa` e publicação do tempo real.
- `app/api/auth/*` — criação de contas de usuário/senha e de convidados com a chave de serviço.

## Ideias para depois

- Simular a física num Web Worker para celulares mais fracos.
- Fichas de personagem e iniciativa.
- Temas de dados (metal, osso, pedra) escolhidos por jogador.
