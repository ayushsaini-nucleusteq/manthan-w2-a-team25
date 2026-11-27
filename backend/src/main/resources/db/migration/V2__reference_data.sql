-- Reference data that must exist in every environment: expense categories and policy version 1.
-- Demo users and claims are added by DemoDataSeeder (app.seed.enabled).

INSERT INTO expense_category (code, name, requires_hotel_details, active, sort_order) VALUES
    ('MEALS',     'Meals',     false, true, 1),
    ('HOTEL',     'Hotel',     true,  true, 2),
    ('LOCAL_CAB', 'Local cab', false, true, 3),
    ('AIRFARE',   'Airfare',   false, true, 4),
    ('TRAIN',     'Train',     false, true, 5),
    ('OTHER',     'Other',     false, true, 6);

INSERT INTO policy_version (id, version_no, change_note, created_by, created_at, receipt_threshold, weekend_flag_enabled,
                            overdue_threshold_hours, auto_approve_max_total, auditor_above_total, finance_head_above_total,
                            sample_audit_percent)
VALUES ('01935f2a-0000-7000-8000-000000000001', 1, 'Initial seed', NULL, '2026-01-01T00:00:00Z', 500.00, true,
        48, 25000.00, 25000.00, 100000.00, 10);

-- Hard limit = 2 x soft limit.
INSERT INTO policy_rule (policy_version_id, code, name, category, unit, city_tier, soft_limit, hard_limit) VALUES
    ('01935f2a-0000-7000-8000-000000000001', 'MEALS_DAILY',         'Meals per day',                 'MEALS',     'PER_DAY',   NULL,    1500.00,  3000.00),
    ('01935f2a-0000-7000-8000-000000000001', 'HOTEL_NIGHTLY_TIER1', 'Hotel per night (tier-1 city)', 'HOTEL',     'PER_NIGHT', 'TIER1', 6000.00, 12000.00),
    ('01935f2a-0000-7000-8000-000000000001', 'HOTEL_NIGHTLY_OTHER', 'Hotel per night (other city)',  'HOTEL',     'PER_NIGHT', 'OTHER', 4000.00,  8000.00),
    ('01935f2a-0000-7000-8000-000000000001', 'LOCAL_CAB_TRIP',      'Local cab per trip',            'LOCAL_CAB', 'PER_TRIP',  NULL,    2000.00,  4000.00);

INSERT INTO policy_tier1_city (policy_version_id, city_key, display_name) VALUES
    ('01935f2a-0000-7000-8000-000000000001', 'ahmedabad', 'Ahmedabad'),
    ('01935f2a-0000-7000-8000-000000000001', 'bengaluru', 'Bengaluru'),
    ('01935f2a-0000-7000-8000-000000000001', 'chennai',   'Chennai'),
    ('01935f2a-0000-7000-8000-000000000001', 'delhi',     'Delhi'),
    ('01935f2a-0000-7000-8000-000000000001', 'hyderabad', 'Hyderabad'),
    ('01935f2a-0000-7000-8000-000000000001', 'kolkata',   'Kolkata'),
    ('01935f2a-0000-7000-8000-000000000001', 'mumbai',    'Mumbai'),
    ('01935f2a-0000-7000-8000-000000000001', 'pune',      'Pune');
