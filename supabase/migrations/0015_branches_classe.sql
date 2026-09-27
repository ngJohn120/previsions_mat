-- ============================================================
-- 0015_branches_classe.sql
-- Une branche SANS sous-branches peut être liée à une classe.
-- La branche reste partagée (catalogue école) : une classe liée vaut pour
-- la branche elle-même, pas pour ses sous-branches (qui ont leur propre
-- classe_id depuis 0014). NULL = branche partagée, toutes classes.
-- on delete cascade : supprimer une classe efface les branches qui lui sont
-- liées, comme les sous-branches dédiées en 0014.
-- ============================================================

alter table public.branches
  add column classe_id uuid references public.classes(id) on delete cascade;

create index idx_branches_classe on public.branches(classe_id);
