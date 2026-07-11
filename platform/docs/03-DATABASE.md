# 03 — Modelo de Dados

Modelagem completa em notação **Prisma**. Este é o contrato do domínio. Princípios:

- **Dinheiro = `BigInt` em centavos** (`amountCents`), com `currency` (default `BRL`). Nunca `Float`.
- Tudo escopado por **`workspaceId`** (multi-tenant). Índices em `(workspaceId, ...)`.
- **Soft delete** (`deletedAt`) nas entidades que o usuário apaga; auditoria em `AuditLog`.
- IDs `cuid()`. Timestamps `createdAt`/`updatedAt` em tudo (omitidos abaixo por brevidade).

> Este arquivo é a *fonte de verdade do modelo*. O `schema.prisma` real será derivado dele na Fase 0.

## Identidade & Tenant

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String?              // null se só OAuth
  name          String
  avatarUrl     String?
  locale        String   @default("pt-BR")
  timezone      String   @default("America/Sao_Paulo")
  emailVerified DateTime?
  memberships   Membership[]
  oauthAccounts OAuthAccount[]
  refreshTokens RefreshToken[]
  deletedAt     DateTime?
}

model OAuthAccount {
  id             String @id @default(cuid())
  userId         String
  provider       String            // "google"
  providerUserId String
  user           User   @relation(fields: [userId], references: [id])
  @@unique([provider, providerUserId])
}

model RefreshToken {
  id          String   @id @default(cuid())
  userId      String
  tokenHash   String              // hash do refresh (permite revogar)
  familyId    String              // rotação/detecção de reuso
  expiresAt   DateTime
  revokedAt   DateTime?
  userAgent   String?
  ip          String?
  user        User     @relation(fields: [userId], references: [id])
  @@index([userId])
}

model Workspace {
  id          String        @id @default(cuid())
  name        String
  type        WorkspaceType             // PERSONAL | BUSINESS
  currency    String        @default("BRL")
  timezone    String        @default("America/Sao_Paulo")
  // dados fiscais (BUSINESS)
  legalName   String?
  taxId       String?                   // CNPJ
  memberships Membership[]
  deletedAt   DateTime?
}

enum WorkspaceType { PERSONAL BUSINESS }

model Membership {
  id          String   @id @default(cuid())
  userId      String
  workspaceId String
  role        Role                      // OWNER | ADMIN | MEMBER | VIEWER
  user        User      @relation(fields: [userId], references: [id])
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  @@unique([userId, workspaceId])
}

enum Role { OWNER ADMIN MEMBER VIEWER }
```

## Contas, Categorias, Transações (núcleo)

```prisma
model Account {                        // conta bancária, carteira, dinheiro
  id             String      @id @default(cuid())
  workspaceId    String
  name           String
  type           AccountType           // CHECKING | SAVINGS | CASH | INVESTMENT | OTHER
  institution    String?
  currentBalance BigInt      @default(0)   // centavos — cache; verdade = soma de transações
  currency       String      @default("BRL")
  bankConnectionId String?             // se veio de Open Finance
  archivedAt     DateTime?
  deletedAt      DateTime?
  @@index([workspaceId])
}

enum AccountType { CHECKING SAVINGS CASH INVESTMENT OTHER }

model Category {
  id           String    @id @default(cuid())
  workspaceId  String
  name         String
  kind         EntryKind             // INCOME | EXPENSE
  icon         String?
  color        String?
  parentId     String?               // subcategoria → aponta para categoria pai
  parent       Category? @relation("CatTree", fields: [parentId], references: [id])
  children     Category[] @relation("CatTree")
  isSystem     Boolean   @default(false)  // categorias-semente
  costCenterId String?                    // empresa: liga a centro de custo
  @@index([workspaceId, kind])
}

enum EntryKind { INCOME EXPENSE }

model Transaction {
  id             String      @id @default(cuid())
  workspaceId    String
  accountId      String?                 // origem do dinheiro (null p/ transação de cartão)
  cardId         String?                 // se for compra no cartão
  categoryId     String?
  kind           EntryKind
  amountCents    BigInt                  // sempre positivo; sinal vem de `kind`
  currency       String      @default("BRL")
  description    String
  date           DateTime                // competência/lançamento
  status         TxStatus    @default(CLEARED) // PENDING | CLEARED | SCHEDULED
  // recorrência / parcelamento
  recurrenceId   String?
  installmentId  String?
  installmentNo  Int?                    // 3 de 12
  // conciliação Open Finance
  externalId     String?                 // id na Pluggy — dedupe
  raw            Json?                   // payload original do provedor
  // empresa
  costCenterId   String?
  counterparty   String?                 // cliente/fornecedor
  createdBy      String?
  deletedAt      DateTime?
  @@index([workspaceId, date])
  @@index([workspaceId, categoryId])
  @@unique([workspaceId, externalId])    // idempotência do sync
}

enum TxStatus { PENDING CLEARED SCHEDULED }
```

## Recorrências & Parcelamentos

```prisma
model RecurringRule {                    // "conta recorrente": aluguel, salário, assinatura
  id           String    @id @default(cuid())
  workspaceId  String
  description  String
  kind         EntryKind
  amountCents  BigInt
  categoryId   String?
  accountId    String?
  cardId       String?
  frequency    Frequency             // DAILY | WEEKLY | MONTHLY | YEARLY
  interval     Int       @default(1) // a cada N períodos
  dayOfMonth   Int?
  startDate    DateTime
  endDate      DateTime?
  nextRunAt    DateTime
  autoPost     Boolean   @default(false) // gera transação automática vs. lembrete
  active       Boolean   @default(true)
  @@index([workspaceId, nextRunAt])
}

enum Frequency { DAILY WEEKLY MONTHLY YEARLY }

model Installment {                       // compra parcelada (ex.: 12x no cartão)
  id            String   @id @default(cuid())
  workspaceId   String
  cardId        String?
  description   String
  totalCents    BigInt
  installments  Int                       // total de parcelas
  firstDueDate  DateTime
  categoryId    String?
  @@index([workspaceId])
}
```

## Cartões de crédito & Faturas

```prisma
model Card {
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  brand         String?                  // Visa/Master...
  institution   String?
  limitCents    BigInt                   // limite total
  closingDay    Int                      // dia de fechamento
  dueDay        Int                      // dia de vencimento
  accountId     String?                  // conta que paga a fatura
  bankConnectionId String?
  archivedAt    DateTime?
  @@index([workspaceId])
}

model CardInvoice {                       // fatura por ciclo
  id            String   @id @default(cuid())
  workspaceId   String
  cardId        String
  periodStart   DateTime
  periodEnd     DateTime
  dueDate       DateTime
  totalCents    BigInt   @default(0)
  paidCents     BigInt   @default(0)
  status        InvoiceStatus @default(OPEN) // OPEN | CLOSED | PAID | OVERDUE
  @@unique([cardId, periodStart])
  @@index([workspaceId, dueDate])
}

enum InvoiceStatus { OPEN CLOSED PAID OVERDUE }
```

## Metas, Reserva, Patrimônio & Investimentos

```prisma
model Goal {                              // meta / "cofrinho"
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  kind          GoalKind             // EMERGENCY_FUND | PURCHASE | CUSTOM
  targetCents   BigInt
  currentCents  BigInt   @default(0)
  deadline      DateTime?
  accountId     String?
  @@index([workspaceId])
}

enum GoalKind { EMERGENCY_FUND PURCHASE CUSTOM }

model Asset {                             // patrimônio: imóvel, veículo, aplicação
  id            String    @id @default(cuid())
  workspaceId   String
  name          String
  type          AssetType            // PROPERTY | VEHICLE | INVESTMENT | CASH | OTHER
  valueCents    BigInt               // valor atual
  acquiredAt    DateTime?
  @@index([workspaceId])
}

enum AssetType { PROPERTY VEHICLE INVESTMENT CASH OTHER }

model Liability {                         // dívida/financiamento
  id            String   @id @default(cuid())
  workspaceId  String
  name         String
  principalCents BigInt
  balanceCents  BigInt
  interestRate  Decimal?  @db.Decimal(6,4)  // % a.m.
  dueDate       DateTime?
  @@index([workspaceId])
}

model Investment {
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  type          String                // renda fixa/variável/fundo...
  investedCents BigInt
  currentCents  BigInt
  bankConnectionId String?
  @@index([workspaceId])
}
```

## Empresarial (DRE / centro de custo / AP-AR)

```prisma
model CostCenter {
  id          String @id @default(cuid())
  workspaceId String
  name        String
  parentId    String?
  @@index([workspaceId])
}

model Payable {                           // conta a pagar
  id           String   @id @default(cuid())
  workspaceId  String
  description  String
  supplier     String?
  amountCents  BigInt
  dueDate      DateTime
  status       BillStatus @default(OPEN)  // OPEN | PAID | OVERDUE | CANCELLED
  costCenterId String?
  categoryId   String?
  @@index([workspaceId, dueDate])
}

model Receivable {                        // conta a receber
  id           String   @id @default(cuid())
  workspaceId  String
  description  String
  customer     String?
  amountCents  BigInt
  dueDate      DateTime
  status       BillStatus @default(OPEN)
  categoryId   String?
  @@index([workspaceId, dueDate])
}

enum BillStatus { OPEN PAID OVERDUE CANCELLED }
```

## Open Finance

```prisma
model BankConnection {                    // "item" na Pluggy
  id            String   @id @default(cuid())
  workspaceId   String
  provider      String   @default("pluggy")
  externalItemId String
  institution   String
  status        ConnStatus @default(ACTIVE) // ACTIVE | LOGIN_ERROR | UPDATING | DISABLED
  credentialEnc Bytes?                    // credenciais criptografadas (se aplicável)
  lastSyncAt    DateTime?
  @@unique([provider, externalItemId])
  @@index([workspaceId])
}

enum ConnStatus { ACTIVE LOGIN_ERROR UPDATING DISABLED }
```

## Inteligência, Alertas & Auditoria

```prisma
model Insight {                           // saída do motor determinístico (auditável)
  id           String   @id @default(cuid())
  workspaceId  String
  type         String              // "overspend" | "cashflow_risk" | "saving_opportunity"...
  severity     Severity            // INFO | WARNING | CRITICAL
  title        String
  body         String              // narrativa (pode vir do LLM)
  metrics      Json                // números que sustentam o insight (fonte de verdade)
  impactCents  BigInt?             // impacto financeiro estimado (para priorização)
  date         DateTime            // dia de referência
  dismissedAt  DateTime?
  @@index([workspaceId, date])
}

enum Severity { INFO WARNING CRITICAL }

model FinancialScore {                     // score diário de saúde financeira
  id          String   @id @default(cuid())
  workspaceId String
  date        DateTime
  score       Int                 // 0..100
  breakdown   Json                // subcomponentes: liquidez, endividamento, poupança...
  @@unique([workspaceId, date])
}

model Forecast {                           // projeções 30/90/365
  id          String   @id @default(cuid())
  workspaceId String
  horizonDays Int
  generatedAt DateTime
  series      Json                // pontos {date, balanceCents, lower, upper}
  method      String              // "recurring+seasonal+montecarlo"
  @@index([workspaceId, horizonDays])
}

model Alert {
  id          String   @id @default(cuid())
  workspaceId String
  type        String              // "card_closing" | "bill_due" | "negative_cashflow"...
  severity    Severity
  payload     Json
  readAt      DateTime?
  @@index([workspaceId, readAt])
}

model Notification {                       // entrega (e-mail/push)
  id          String   @id @default(cuid())
  userId      String
  channel     String              // email | push
  status      String              // queued | sent | failed
  payload     Json
}

model AuditLog {                           // LGPD + segurança
  id          String   @id @default(cuid())
  workspaceId String?
  userId      String?
  action      String              // "transaction.create", "auth.login"...
  entity      String?
  entityId    String?
  ip          String?
  metadata    Json?
  @@index([workspaceId, action])
}
```

## Notas de modelagem

- **Saldo**: `Account.currentBalance` é *cache*. A verdade é a soma das transações; um job
  reconcilia. Evita divergência sob concorrência.
- **Dedupe do Open Finance**: `Transaction.externalId` + `@@unique([workspaceId, externalId])`
  torna o sync **idempotente** (reprocessar webhook não duplica).
- **Relatórios pesados** (DRE, fluxo anual) → **views materializadas**, fora deste schema,
  atualizadas por worker. Não sobrecarregam a tabela transacional.
- **Particionamento futuro**: `Transaction` por `workspaceId`/mês quando o volume exigir.
