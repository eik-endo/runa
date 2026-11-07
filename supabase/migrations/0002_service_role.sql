-- Runa: explicit privileges for the server-side role and an API schema reload.
-- Idempotent.

-- The account routes (app/api/auth/*) use the secret / service_role key.
-- Projects created without "expose new tables" do not grant it anything by default.
grant usage on schema public to service_role;
grant all on table public.profiles, public.mesas, public.mesa_members, public.rolls, public.custom_dice to service_role;

-- Make the Data API (PostgREST) see the new tables and functions right away.
notify pgrst, 'reload schema';
