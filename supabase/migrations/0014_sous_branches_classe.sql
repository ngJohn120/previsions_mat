-- ============================================================
-- 0014_sous_branches_classe.sql
-- Les sous-branches portent une classe (primaire) : « Grammaire » → 3e A.
-- La branche reste partagée (catalogue école) ; l'identité d'une
-- sous-branche passe de (branche, nom) à (branche, nom, classe).
-- - NULLS NOT DISTINCT (PG15+) : une même (branche, nom) n'existe qu'une
--   fois sans classe, et une fois par classe liée.
-- - on delete cascade : supprimer une classe supprime les sous-branches
--   dédiées (les attributions perdent alors leur lien sous-branche via
--   leur propre FK, déjà en SET NULL).
-- ============================================================

alter table public.sous_branches
  add column classe_id uuid references public.classes(id) on delete cascade;

alter table public.sous_branches
  drop constraint sous_branches_branche_id_name_key;

create unique index sous_branches_branche_id_name_classe_id_key
  on public.sous_branches (branche_id, name, classe_id) nulls not distinct;

create index idx_sous_branches_classe on public.sous_branches(classe_id);
