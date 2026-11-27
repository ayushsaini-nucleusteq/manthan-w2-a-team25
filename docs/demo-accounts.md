# Demo accounts

The demo seeder (`DemoDataSeeder`, runs once on an empty database) creates 150 users in 8 departments.
Every seeded user signs in with their email and **one shared demo password**, taken from the environment
variable `SEED_USER_PASSWORD`. The real value lives only in your local `.env` (gitignored). `.env.example` holds
a placeholder. Passwords are stored as BCrypt hashes and never logged.

Seeded emails follow `firstname.lastname@expenseflow.test`.

| Role | Name | Email | Reports to | Lands on |
|---|---|---|---|---|
| Employee | Asha Verma (Engineering) | `asha.verma@expenseflow.test` | Ravi Kumar | E1 My claims |
| Manager | Ravi Kumar (Engineering) | `ravi.kumar@expenseflow.test` | Engineering head | M1 Approval inbox |
| Finance auditor | Meera Iyer (Finance) | `meera.iyer@expenseflow.test` | Kavya Menon | A1 Review queue |
| Finance head (admin) | Arjun Shah (Finance) | `arjun.shah@expenseflow.test` | (none) | F1 Dashboard |

Other fixed accounts in the seed:

- Second finance head: `kavya.menon@expenseflow.test`. Arjun Shah has no manager, so his own claims' manager step goes to the finance-head pool, which means Kavya.
- Further auditors: `rohan.das@expenseflow.test`, `sneha.kapoor@expenseflow.test`.

Notes:

- Every user also holds `EMPLOYEE`; the JWT carries all of a user's roles, and the home screen is the highest one.
- The seed is skipped when the database already has users. To re-seed, remove the `pgdata` volume (`docker compose down -v`), which deletes all data.
- Change `SEED_USER_PASSWORD` before the first start. Changing it later does not re-hash existing users.
