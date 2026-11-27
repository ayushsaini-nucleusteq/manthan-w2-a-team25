-- ExpenseFlow schema. Source of truth: docs/data-model.md.
-- Enums are varchar + CHECK; money is numeric(12,2) INR; timestamps are timestamptz (UTC).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------------ organisation

CREATE TABLE department (
    id   uuid PRIMARY KEY DEFAULT uuidv7(),
    code varchar(20)  NOT NULL UNIQUE,
    name varchar(100) NOT NULL UNIQUE
);

CREATE TABLE app_user (
    id                  uuid PRIMARY KEY DEFAULT uuidv7(),
    email               citext       NOT NULL UNIQUE,
    full_name           varchar(120) NOT NULL,
    employee_code       varchar(20)  NOT NULL UNIQUE,
    password_hash       varchar(100) NOT NULL,
    department_id       uuid         NOT NULL REFERENCES department (id),
    manager_id          uuid         REFERENCES app_user (id),
    bank_account_number varchar(18)  CHECK (bank_account_number ~ '^\d{9,18}$'),
    ifsc_code           char(11)     CHECK (ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
    active              boolean      NOT NULL DEFAULT true,
    version             integer      NOT NULL DEFAULT 0,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE INDEX app_user_manager_idx ON app_user (manager_id);
CREATE INDEX app_user_department_idx ON app_user (department_id);

CREATE TABLE user_role (
    user_id uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role    varchar(20) NOT NULL CHECK (role IN ('EMPLOYEE', 'MANAGER', 'AUDITOR', 'FINANCE_HEAD')),
    PRIMARY KEY (user_id, role)
);
CREATE INDEX user_role_role_idx ON user_role (role, user_id);

CREATE TABLE delegation (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    delegator_id uuid        NOT NULL REFERENCES app_user (id),
    delegate_id  uuid        NOT NULL REFERENCES app_user (id),
    starts_on    date        NOT NULL,
    ends_on      date        NOT NULL,
    reason       varchar(500),
    created_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    CHECK (delegate_id <> delegator_id),
    CHECK (ends_on >= starts_on),
    EXCLUDE USING gist (delegator_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&) WHERE (revoked_at IS NULL)
);
CREATE INDEX delegation_delegate_idx ON delegation (delegate_id, starts_on, ends_on) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------------ policy configuration (versioned)

CREATE TABLE expense_category (
    code                   varchar(30) PRIMARY KEY,
    name                   varchar(60) NOT NULL,
    requires_hotel_details boolean     NOT NULL DEFAULT false,
    active                 boolean     NOT NULL DEFAULT true,
    sort_order             smallint    NOT NULL DEFAULT 0
);

CREATE TABLE policy_version (
    id                       uuid PRIMARY KEY DEFAULT uuidv7(),
    version_no               integer       NOT NULL UNIQUE CHECK (version_no >= 1),
    change_note              varchar(500),
    created_by               uuid          REFERENCES app_user (id),
    created_at               timestamptz   NOT NULL DEFAULT now(),
    receipt_threshold        numeric(12,2) NOT NULL CHECK (receipt_threshold >= 0),
    weekend_flag_enabled     boolean       NOT NULL,
    overdue_threshold_hours  integer       NOT NULL CHECK (overdue_threshold_hours BETWEEN 1 AND 720),
    auto_approve_max_total   numeric(12,2) NOT NULL,
    auditor_above_total      numeric(12,2) NOT NULL,
    finance_head_above_total numeric(12,2) NOT NULL,
    sample_audit_percent     smallint      NOT NULL CHECK (sample_audit_percent BETWEEN 0 AND 100),
    CHECK (finance_head_above_total >= auditor_above_total)
);

CREATE TABLE policy_rule (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    policy_version_id uuid          NOT NULL REFERENCES policy_version (id),
    code              varchar(50)   NOT NULL,
    name              varchar(80)   NOT NULL,
    category          varchar(30)   NOT NULL REFERENCES expense_category (code),
    unit              varchar(10)   NOT NULL CHECK (unit IN ('PER_DAY', 'PER_NIGHT', 'PER_TRIP')),
    city_tier         varchar(6)    CHECK (city_tier IN ('TIER1', 'OTHER')),
    soft_limit        numeric(12,2) NOT NULL CHECK (soft_limit >= 0),
    hard_limit        numeric(12,2) NOT NULL,
    UNIQUE (policy_version_id, code),
    CHECK (hard_limit >= soft_limit)
);

CREATE TABLE policy_tier1_city (
    policy_version_id uuid        NOT NULL REFERENCES policy_version (id),
    city_key          varchar(80) NOT NULL,
    display_name      varchar(80) NOT NULL,
    PRIMARY KEY (policy_version_id, city_key)
);

-- ------------------------------------------------------------------ payouts (referenced by claims)

CREATE TABLE payout_batch (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    batch_number   varchar(20)   NOT NULL UNIQUE,
    status         varchar(10)   NOT NULL CHECK (status IN ('CREATED', 'EXPORTED', 'PAID')),
    claim_count    integer       NOT NULL,
    total_amount   numeric(14,2) NOT NULL,
    created_by     uuid          NOT NULL REFERENCES app_user (id),
    created_at     timestamptz   NOT NULL DEFAULT now(),
    exported_at    timestamptz,
    paid_at        timestamptz,
    paid_by        uuid          REFERENCES app_user (id),
    bank_reference varchar(64),
    version        integer       NOT NULL DEFAULT 0
);
CREATE INDEX payout_batch_status_idx ON payout_batch (status, created_at DESC);

-- ------------------------------------------------------------------ claims

-- claim_number = 'CL-' || lpad(nextval('claim_number_seq'), 6, '0'); unique and searchable.
CREATE SEQUENCE claim_number_seq;

CREATE TABLE expense_claim (
    id                  uuid PRIMARY KEY DEFAULT uuidv7(),
    claim_number        varchar(20)   NOT NULL UNIQUE,
    employee_id         uuid          NOT NULL REFERENCES app_user (id),
    department_id       uuid          NOT NULL REFERENCES department (id),
    title               varchar(150)  NOT NULL,
    purpose             varchar(1000),
    trip_start_date     date,
    trip_end_date       date,
    currency            char(3)       NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    status              varchar(25)   NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'AUTO_APPROVED', 'AUTO_REJECTED',
                            'PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD', 'SENT_BACK', 'REJECTED',
                            'APPROVED', 'IN_BATCH', 'PAID')),
    total_amount        numeric(12,2) NOT NULL DEFAULT 0,
    submission_no       integer       NOT NULL DEFAULT 0,
    policy_version_id   uuid          REFERENCES policy_version (id),
    policy_outcome      varchar(15)   CHECK (policy_outcome IN ('AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT')),
    decision_reason     varchar(2000),
    sample_audit        boolean       NOT NULL DEFAULT false,
    sample_audit_status varchar(10)   CHECK (sample_audit_status IN ('PENDING', 'CLEARED', 'REJECTED', 'SENT_BACK')),
    sample_audited_by   uuid          REFERENCES app_user (id),
    sample_audited_at   timestamptz,
    payout_batch_id     uuid          REFERENCES payout_batch (id),
    submitted_at        timestamptz,
    decided_at          timestamptz,
    paid_at             timestamptz,
    version             integer       NOT NULL DEFAULT 0,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CHECK (trip_end_date IS NULL OR trip_start_date IS NULL OR trip_end_date >= trip_start_date),
    CHECK (NOT sample_audit OR status IN ('AUTO_APPROVED', 'SENT_BACK', 'REJECTED', 'IN_BATCH', 'PAID')),
    CHECK (status NOT IN ('REJECTED', 'AUTO_REJECTED') OR decision_reason IS NOT NULL)
);
CREATE INDEX expense_claim_owner_idx ON expense_claim (employee_id, status, updated_at DESC);
CREATE INDEX expense_claim_status_idx ON expense_claim (status, submitted_at);
CREATE INDEX expense_claim_department_idx ON expense_claim (department_id, status);
CREATE INDEX expense_claim_sample_idx ON expense_claim (sample_audit_status) WHERE sample_audit;
CREATE INDEX expense_claim_decided_idx ON expense_claim (decided_at)
    WHERE status IN ('APPROVED', 'AUTO_APPROVED', 'IN_BATCH', 'PAID');

CREATE TABLE expense_line (
    id                          uuid PRIMARY KEY DEFAULT uuidv7(),
    claim_id                    uuid          NOT NULL REFERENCES expense_claim (id) ON DELETE CASCADE,
    employee_id                 uuid          NOT NULL REFERENCES app_user (id),
    line_no                     smallint      NOT NULL,
    category                    varchar(30)   NOT NULL REFERENCES expense_category (code),
    amount                      numeric(12,2) NOT NULL CHECK (amount > 0),
    expense_date                date          NOT NULL,
    vendor                      varchar(150)  NOT NULL,
    vendor_key                  varchar(150)  GENERATED ALWAYS AS (lower(regexp_replace(btrim(vendor), '\s+', ' ', 'g'))) STORED,
    notes                       varchar(500),
    city                        varchar(80),
    nights                      smallint      CHECK (nights BETWEEN 1 AND 60),
    policy_outcome              varchar(15)   CHECK (policy_outcome IN ('AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT')),
    evaluated_policy_version_id uuid          REFERENCES policy_version (id),
    evaluated_at                timestamptz,
    needs_evaluation            boolean       NOT NULL DEFAULT true,
    created_at                  timestamptz   NOT NULL DEFAULT now(),
    updated_at                  timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (claim_id, line_no),
    CHECK ((category = 'HOTEL') = (city IS NOT NULL AND nights IS NOT NULL))
);
CREATE INDEX expense_line_duplicate_idx ON expense_line (employee_id, vendor_key, amount, expense_date);
CREATE INDEX expense_line_day_idx ON expense_line (employee_id, category, expense_date);
CREATE INDEX expense_line_claim_idx ON expense_line (claim_id);

CREATE TABLE receipt (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    line_id      uuid         NOT NULL UNIQUE REFERENCES expense_line (id) ON DELETE CASCADE,
    storage_key  varchar(255) NOT NULL UNIQUE,
    file_name    varchar(255) NOT NULL,
    content_type varchar(50)  NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes   integer      NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    sha256       char(64)     NOT NULL,
    uploaded_by  uuid         NOT NULL REFERENCES app_user (id),
    uploaded_at  timestamptz  NOT NULL DEFAULT now()
);
-- Not unique on purpose: a reused receipt must be stored so the policy engine can auto-reject it.
CREATE INDEX receipt_sha256_idx ON receipt (sha256);

CREATE TABLE policy_finding (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    claim_id          uuid          NOT NULL REFERENCES expense_claim (id) ON DELETE CASCADE,
    line_id           uuid          REFERENCES expense_line (id) ON DELETE CASCADE,
    policy_version_id uuid          NOT NULL REFERENCES policy_version (id),
    rule_code         varchar(50)   NOT NULL,
    rule_name         varchar(80)   NOT NULL,
    reason_code       varchar(50)   NOT NULL,
    outcome           varchar(15)   NOT NULL CHECK (outcome IN ('AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT')),
    message           varchar(500)  NOT NULL,
    limit_type        varchar(4)    CHECK (limit_type IN ('SOFT', 'HARD')),
    unit              varchar(10),
    limit_value       numeric(12,2),
    actual_value      numeric(12,2),
    excess_value      numeric(12,2),
    matched_claim_id  uuid,
    matched_line_id   uuid,
    evaluated_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX policy_finding_line_idx ON policy_finding (line_id);
CREATE INDEX policy_finding_claim_idx ON policy_finding (claim_id) WHERE line_id IS NULL;
CREATE INDEX policy_finding_reason_idx ON policy_finding (reason_code, evaluated_at);

CREATE TABLE sample_audit_block (
    block_no        integer  PRIMARY KEY,
    target_position smallint NOT NULL CHECK (target_position BETWEEN 1 AND 100),
    filled          smallint NOT NULL DEFAULT 0 CHECK (filled >= 0)
);

-- ------------------------------------------------------------------ approval chain

CREATE TABLE approval_step (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    claim_id           uuid        NOT NULL REFERENCES expense_claim (id) ON DELETE CASCADE,
    sequence           smallint    NOT NULL,
    step_type          varchar(20) NOT NULL CHECK (step_type IN ('MANAGER', 'AUDITOR', 'FINANCE_HEAD', 'SAMPLE_AUDIT')),
    required_role      varchar(20) NOT NULL CHECK (required_role IN ('MANAGER', 'AUDITOR', 'FINANCE_HEAD')),
    assignee_id        uuid        REFERENCES app_user (id),
    status             varchar(15) NOT NULL CHECK (status IN ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SENT_BACK', 'CANCELLED')),
    pending_since      timestamptz,
    sent_back_by       uuid        REFERENCES app_user (id),
    acted_by           uuid        REFERENCES app_user (id),
    acted_on_behalf_of uuid        REFERENCES app_user (id),
    acted_at           timestamptz,
    comment            varchar(2000),
    UNIQUE (claim_id, sequence),
    UNIQUE (claim_id, step_type)
);
CREATE UNIQUE INDEX approval_step_one_pending ON approval_step (claim_id) WHERE status = 'PENDING';
CREATE INDEX approval_step_assignee_idx ON approval_step (assignee_id) WHERE status = 'PENDING';
CREATE INDEX approval_step_pool_idx ON approval_step (required_role, pending_since) WHERE status = 'PENDING';
CREATE INDEX approval_step_actor_idx ON approval_step (acted_by, acted_at);

-- Nobody acts on their own claim, whatever the application does.
CREATE FUNCTION approval_step_not_own_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.acted_by IS NOT NULL
       AND NEW.acted_by = (SELECT employee_id FROM expense_claim WHERE id = NEW.claim_id) THEN
        RAISE EXCEPTION 'approval_step: the claim owner cannot act on their own claim';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER approval_step_not_own_claim BEFORE INSERT OR UPDATE ON approval_step
    FOR EACH ROW EXECUTE FUNCTION approval_step_not_own_claim();

-- ------------------------------------------------------------------ notifications, payout items

CREATE TABLE notification (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    recipient_id    uuid         NOT NULL REFERENCES app_user (id),
    type            varchar(20)  NOT NULL CHECK (type IN ('APPROVAL_WAITING', 'SENT_BACK', 'PAYOUT_DONE', 'CLAIM_DECIDED')),
    claim_id        uuid         REFERENCES expense_claim (id) ON DELETE CASCADE,
    payout_batch_id uuid         REFERENCES payout_batch (id),
    title           varchar(150) NOT NULL,
    message         varchar(500) NOT NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    read_at         timestamptz
);
CREATE INDEX notification_recipient_idx ON notification (recipient_id, created_at DESC);
CREATE INDEX notification_unread_idx ON notification (recipient_id) WHERE read_at IS NULL;

CREATE TABLE payout_item (
    id                  uuid PRIMARY KEY DEFAULT uuidv7(),
    batch_id            uuid          NOT NULL REFERENCES payout_batch (id),
    claim_id            uuid          NOT NULL UNIQUE REFERENCES expense_claim (id),
    employee_id         uuid          NOT NULL REFERENCES app_user (id),
    amount              numeric(12,2) NOT NULL,
    bank_account_number varchar(18)   NOT NULL,
    ifsc_code           char(11)      NOT NULL
);
CREATE INDEX payout_item_batch_idx ON payout_item (batch_id);

-- ------------------------------------------------------------------ append-only audit trail

CREATE TABLE audit_event (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at     timestamptz  NOT NULL DEFAULT now(),
    actor_id        uuid         REFERENCES app_user (id),
    on_behalf_of_id uuid         REFERENCES app_user (id),
    action          varchar(40)  NOT NULL,
    entity_type     varchar(20)  NOT NULL,
    entity_id       varchar(64)  NOT NULL,
    claim_id        uuid,
    from_status     varchar(25),
    to_status       varchar(25),
    comment         varchar(2000),
    details         jsonb,
    request_id      varchar(64)
);
CREATE INDEX audit_event_claim_idx ON audit_event (claim_id, occurred_at, id);
CREATE INDEX audit_event_actor_idx ON audit_event (actor_id, occurred_at);
CREATE INDEX audit_event_action_idx ON audit_event (action, occurred_at);
CREATE INDEX audit_event_time_idx ON audit_event (occurred_at);

CREATE FUNCTION audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_event is append-only (% is not allowed)', TG_OP;
END $$;
CREATE TRIGGER audit_event_no_update_delete BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
    FOR EACH STATEMENT EXECUTE FUNCTION audit_event_append_only();

-- Defence in depth: the application's DB user loses UPDATE/DELETE/TRUNCATE on the audit table.
-- (Compose uses one DB user for Flyway and the app, so this revokes from the owner itself.)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM CURRENT_USER;
