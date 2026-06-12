-- ============================================================
-- ZENITHONE CREDIT UNION — Initial Database Schema (idempotent)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Helper: generate unique 10-digit account number ──────────
CREATE OR REPLACE FUNCTION generate_account_number() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE num TEXT;
BEGIN
  LOOP
    num := LPAD(floor(random() * 9000000000 + 1000000000)::TEXT, 10, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.accounts WHERE account_number = num);
  END LOOP;
  RETURN num;
END;
$$;

-- ── Helper: updated_at timestamp ─────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── Helper: auto-update account balance after transaction ────
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.transaction_type IN ('credit', 'transfer_in', 'interest') THEN
      UPDATE public.accounts SET
        balance           = balance           + NEW.amount,
        available_balance = available_balance + NEW.amount,
        updated_at        = now()
      WHERE id = NEW.account_id;
    ELSIF NEW.transaction_type IN ('debit', 'transfer_out', 'fee') THEN
      UPDATE public.accounts SET
        balance           = balance           - NEW.amount,
        available_balance = available_balance - NEW.amount,
        updated_at        = now()
      WHERE id = NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Profiles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name               TEXT,
  phone                   TEXT,
  address                 TEXT,
  city                    TEXT,
  state                   CHAR(2),
  zip                     VARCHAR(10),
  date_of_birth           DATE,
  ssn_last_four           VARCHAR(4),
  kyc_verified            BOOLEAN     DEFAULT false,
  preferred_language      TEXT        DEFAULT 'en',
  notifications_email     BOOLEAN     DEFAULT true,
  notifications_sms       BOOLEAN     DEFAULT true,
  two_factor_enabled      BOOLEAN     DEFAULT false,
  banking_tier            TEXT        DEFAULT 'standard'
    CHECK (banking_tier IN ('standard','premium','private','black')),
  relationship_manager_id UUID,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Service role full access"     ON public.profiles;
CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role full access"     ON public.profiles USING (auth.role() = 'service_role');

-- ── Accounts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_number    TEXT UNIQUE NOT NULL,
  account_type      TEXT NOT NULL
    CHECK (account_type IN ('checking','savings','money_market','investment','cd','business')),
  account_tier      TEXT DEFAULT 'standard'
    CHECK (account_tier IN ('standard','premium','private','black')),
  account_name      TEXT,
  balance           NUMERIC(18,2) DEFAULT 0.00,
  available_balance NUMERIC(18,2) DEFAULT 0.00,
  pending_balance   NUMERIC(18,2) DEFAULT 0.00,
  interest_rate     NUMERIC(6,4)  DEFAULT 0.0000,
  currency          CHAR(3)       DEFAULT 'USD',
  status            TEXT          DEFAULT 'active'
    CHECK (status IN ('active','frozen','suspended','closed')),
  routing_number    TEXT          DEFAULT '021000021',
  opened_date       DATE          DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ   DEFAULT now(),
  updated_at        TIMESTAMPTZ   DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own accounts"   ON public.accounts;
DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Service role full access"      ON public.accounts;
CREATE POLICY "Users can view own accounts"   ON public.accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own accounts" ON public.accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"      ON public.accounts USING (auth.role() = 'service_role');

-- ── Auto-create profile + default accounts on signup ─────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _account_type TEXT;
  _full_name    TEXT;
BEGIN
  _full_name    := COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1));
  _account_type := COALESCE(NULLIF(NEW.raw_user_meta_data->>'account_type', ''), 'checking');

  INSERT INTO public.profiles (
    id, full_name, phone, address, city, state, date_of_birth, ssn_last_four
  ) VALUES (
    NEW.id,
    _full_name,
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'address', ''),
    NULLIF(NEW.raw_user_meta_data->>'city', ''),
    NULLIF(NEW.raw_user_meta_data->>'state', ''),
    NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::DATE,
    NULLIF(NEW.raw_user_meta_data->>'ssn_last_four', '')
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.accounts (
    user_id, account_number, account_type, account_name,
    balance, available_balance, interest_rate, status
  ) VALUES (
    NEW.id,
    generate_account_number(),
    _account_type,
    _full_name || ' ' || initcap(_account_type),
    0.00, 0.00,
    CASE _account_type
      WHEN 'savings'      THEN 0.0485
      WHEN 'money_market' THEN 0.0485
      ELSE 0.0000
    END,
    'active'
  );

  IF _account_type NOT IN ('savings', 'investment') THEN
    INSERT INTO public.accounts (
      user_id, account_number, account_type, account_name,
      balance, available_balance, interest_rate, status
    ) VALUES (
      NEW.id,
      generate_account_number(),
      'savings',
      _full_name || ' Savings',
      0.00, 0.00, 0.0485, 'active'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── Transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id),
  user_id           UUID NOT NULL REFERENCES public.profiles(id),
  transaction_type  TEXT NOT NULL
    CHECK (transaction_type IN ('debit','credit','transfer_out','transfer_in','interest','fee','reversal')),
  category          TEXT NOT NULL DEFAULT 'other',
  description       TEXT NOT NULL,
  merchant_name     TEXT,
  merchant_category TEXT,
  amount            NUMERIC(18,2) NOT NULL,
  balance_after     NUMERIC(18,2),
  status            TEXT DEFAULT 'completed'
    CHECK (status IN ('pending','completed','failed','cancelled','disputed')),
  reference_number  TEXT UNIQUE DEFAULT 'TXN' || extract(epoch from now())::bigint || floor(random()*1000)::int,
  related_account_id UUID REFERENCES public.accounts(id),
  ip_address        TEXT,
  device_info       TEXT,
  is_international  BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now(),
  processed_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Service role full access"        ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"        ON public.transactions USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON public.transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id    ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status     ON public.transactions(status);

DROP TRIGGER IF EXISTS transaction_balance_update ON public.transactions;
CREATE TRIGGER transaction_balance_update
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE update_account_balance();

-- ── Cards ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cards (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id            UUID NOT NULL REFERENCES public.accounts(id),
  user_id               UUID NOT NULL REFERENCES public.profiles(id),
  card_number_last_four VARCHAR(4) NOT NULL,
  card_number_token     TEXT UNIQUE,
  card_type             TEXT NOT NULL CHECK (card_type IN ('debit','credit')),
  card_tier             TEXT DEFAULT 'standard'
    CHECK (card_tier IN ('standard','gold','platinum','black')),
  card_name             TEXT,
  expiry_month          SMALLINT NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year           SMALLINT NOT NULL,
  cardholder_name       TEXT NOT NULL,
  status                TEXT DEFAULT 'active'
    CHECK (status IN ('active','frozen','expired','cancelled','lost','stolen')),
  credit_limit          NUMERIC(18,2),
  available_credit      NUMERIC(18,2),
  current_balance       NUMERIC(18,2) DEFAULT 0.00,
  billing_cycle_day     SMALLINT DEFAULT 1,
  payment_due_date      DATE,
  minimum_payment       NUMERIC(18,2),
  rewards_points        INTEGER DEFAULT 0,
  rewards_tier          TEXT DEFAULT 'standard',
  allow_international   BOOLEAN DEFAULT true,
  allow_online          BOOLEAN DEFAULT true,
  allow_atm             BOOLEAN DEFAULT false,
  daily_limit           NUMERIC(18,2) DEFAULT 5000.00,
  transaction_limit     NUMERIC(18,2) DEFAULT 2500.00,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cards"   ON public.cards;
DROP POLICY IF EXISTS "Users can update own cards" ON public.cards;
DROP POLICY IF EXISTS "Service role full access"   ON public.cards;
CREATE POLICY "Users can view own cards"   ON public.cards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own cards" ON public.cards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"   ON public.cards USING (auth.role() = 'service_role');

-- ── Investments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.investments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id     UUID NOT NULL REFERENCES public.accounts(id),
  user_id        UUID NOT NULL REFERENCES public.profiles(id),
  symbol         TEXT NOT NULL,
  name           TEXT NOT NULL,
  asset_type     TEXT NOT NULL
    CHECK (asset_type IN ('stock','etf','bond','mutual_fund','crypto','reit','option')),
  quantity       NUMERIC(18,8) NOT NULL,
  purchase_price NUMERIC(18,4) NOT NULL,
  current_price  NUMERIC(18,4) DEFAULT 0,
  total_value    NUMERIC(18,2) GENERATED ALWAYS AS (quantity * current_price) STORED,
  cost_basis     NUMERIC(18,2) GENERATED ALWAYS AS (quantity * purchase_price) STORED,
  gain_loss      NUMERIC(18,2) GENERATED ALWAYS AS ((quantity * current_price) - (quantity * purchase_price)) STORED,
  gain_loss_pct  NUMERIC(8,4)  GENERATED ALWAYS AS (
    CASE WHEN purchase_price > 0
      THEN ((current_price - purchase_price) / purchase_price * 100)
      ELSE 0
    END
  ) STORED,
  currency       CHAR(3) DEFAULT 'USD',
  last_updated   TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own investments" ON public.investments;
DROP POLICY IF EXISTS "Service role full access"       ON public.investments;
CREATE POLICY "Users can view own investments" ON public.investments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"       ON public.investments USING (auth.role() = 'service_role');

-- ── Beneficiaries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beneficiaries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nickname              TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  bank_name             TEXT NOT NULL,
  routing_number        TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  account_number_hash   TEXT NOT NULL,
  account_type          TEXT DEFAULT 'checking'
    CHECK (account_type IN ('checking','savings')),
  relationship          TEXT,
  is_verified           BOOLEAN DEFAULT false,
  daily_limit           NUMERIC(18,2) DEFAULT 10000.00,
  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own beneficiaries" ON public.beneficiaries;
CREATE POLICY "Users can manage own beneficiaries" ON public.beneficiaries USING (auth.uid() = user_id);

-- ── Notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  type       TEXT DEFAULT 'system'
    CHECK (type IN ('transaction','security','promotional','system','alert')),
  priority   TEXT DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  read       BOOLEAN DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role full access"           ON public.notifications;
CREATE POLICY "Users can view own notifications"   ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"           ON public.notifications USING (auth.role() = 'service_role');

-- ── Audit Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.profiles(id),
  action      TEXT NOT NULL,
  resource    TEXT,
  resource_id UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON public.audit_log;
CREATE POLICY "Service role only" ON public.audit_log USING (auth.role() = 'service_role');

-- ── updated_at triggers ───────────────────────────────────────
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS accounts_updated_at ON public.accounts;
DROP TRIGGER IF EXISTS cards_updated_at    ON public.cards;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON public.accounts  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
CREATE TRIGGER cards_updated_at    BEFORE UPDATE ON public.cards     FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

-- ── Table comments ────────────────────────────────────────────
COMMENT ON TABLE public.profiles      IS 'User profile data extending Supabase auth.users';
COMMENT ON TABLE public.accounts      IS 'Bank accounts (checking, savings, money market, etc.)';
COMMENT ON TABLE public.transactions  IS 'All financial transactions with full audit trail';
COMMENT ON TABLE public.cards         IS 'Debit and credit card management';
COMMENT ON TABLE public.investments   IS 'Investment holdings and portfolio tracking';
COMMENT ON TABLE public.beneficiaries IS 'Saved external transfer recipients';
COMMENT ON TABLE public.notifications IS 'In-app and push notification records';
COMMENT ON TABLE public.audit_log     IS 'Complete audit trail for compliance and security';
