# Layer labels — staging checklist

Run everything on a **separate staging Supabase project**. Nothing here is
applied to production until every box is ticked and you decide to.

Migrations, in order:

1. `supabase/migrations/20261010090000_layer_labels.sql`
2. `supabase/migrations/20261010110000_layer_labels_consent.sql`

Tests: `supabase/tests/layer_labels_rls.sql` (one transaction, always rolled back).

## 1. Prepare the staging project

- [ ] Create a new Supabase project (free tier is fine). Note its project ref; it must **not** be `utlrpeyplazojlwostor` (production).
- [ ] Bring its schema up to production's: in the staging SQL editor run every file in `supabase/migrations/` in name order, up to and including `20261009090000_platform_layers_admin_only.sql`.
      Production has legacy columns not in the repo (`institutions.owner_user_id`, `kind`). If you want staging to match exactly, run this on **production** (read-only) and compare with staging:
      ```sql
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name in ('institutions','institution_members','buildings','platform_admins')
      order by table_name, ordinal_position;
      ```
- [ ] Confirm you are in the staging project: the URL in the browser shows the staging ref.

## 2. Apply the migrations

- [ ] SQL editor → paste migration 1 → Run. Expect "Success. No rows returned".
- [ ] SQL editor → paste migration 2 → Run. Expect "Success. No rows returned".
- [ ] Run both again, in the same order (they are idempotent). Expect success again.
- [ ] Check the objects exist:
      ```sql
      select to_regclass('public.layer_labels')            as labels,
             to_regclass('public.layer_training_consents') as consents,
             to_regclass('public.layer_label_consents')    as old_consents,   -- expect NULL
             (select public from storage.buckets where id = 'cad-sources') as bucket_public;  -- expect false
      ```

## 3. Run the access tests

- [ ] SQL editor → paste `supabase/tests/layer_labels_rls.sql` → Run.
      Expect one row: `layer_labels access: all checks passed`.
      A failure stops with `FAIL: …` — send me the message. Nothing is kept either way.
- [ ] Optional, with psql:
      `psql "<staging connection string>" -v ON_ERROR_STOP=1 -f supabase/tests/layer_labels_rls.sql`
- [ ] Confirm nothing was left behind:
      ```sql
      select count(*) from public.buildings where name like 'RLS test venue%';   -- expect 0
      ```

## 4. Try it through the app (staging)

Point a local dev build at staging: in `.env.local` set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` to the staging values, start the labeling service
(`ml/README` / `python -m server`), then `npm run dev`.

- [ ] Sign in as an institution **owner**, open a venue → Floor editor → Import CAD → pick a DXF.
      The training notice appears with Allow / Don't allow. Choose Allow.
- [ ] Labeling shows progress, then the review list (lowest confidence first).
- [ ] "Create venue" stays disabled until every layer is confirmed; ignore / walkable / unknown rows
      need their own confirmation; an "unknown" row must be changed first.
- [ ] Confirm a group, bulk-confirm the rest, create the venue. Then check:
      ```sql
      select layer_name, ai_label, final_label, was_corrected, confirmed_via
      from public.layer_labels order by created_at desc limit 50;
      select name from storage.objects where bucket_id = 'cad-sources' order by created_at desc limit 5;
      ```
- [ ] Sign in as a non-owner **editor** of the same venue: the notice shows the decision but no buttons.
- [ ] As a platform admin: `select count(*) from public.layer_label_training_rows();` returns only
      individual/group rows from venues with consent, and `layer_summary->'texts'` is `[]`.
- [ ] As the owner, revoke consent (Don't allow). Re-run the export: that venue's rows are gone.

## 5. Before production

- [ ] The training notice text has been through legal review (`src/lib/cad/layerLabels/consent.ts`, marked `LEGAL REVIEW NEEDED`).
- [ ] Back up production (Database → Backups) or note the latest automatic backup time.
- [ ] Apply migration 1, then migration 2, in the production SQL editor; run the tests there (they roll back).
