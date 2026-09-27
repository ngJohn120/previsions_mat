-- ============================================================
-- 0017_sous_branches_without_branch.sql
-- Certaines matières n'appartiennent à AUCUNE branche : elles n'existent
-- que comme sous-branches, rattachées à une ou plusieurs classes (ex.
-- « Dessin » en 1ère et 3e, sans branche parente). Le catalogue shared
-- l'exige déjà (branches et sous_branches sont des lignes distinctes).
--
-- Conséquence : branche_id devient NULLABLE dans sous_branches ET dans
-- attributions (sinon une matière sans branche ne peut pas être attribuée
-- à un enseignant = donnée morte). Aucune donnée existante n'est-null :
-- le DROP NOT NULL est sans risque.
--
-- L'affichage n'est PAS modifié dans cette migration : c'est un choix
-- produit (que montrer dans « Cours », l'en-tête de fiche…). Voir le
-- point ouvert au dos de la carte.
-- ============================================================

alter table public.sous_branches
  alter column branche_id drop not null;

alter table public.attributions
  alter column branche_id drop not null;

-- Une matière « sans branche » est identifiée par son nom + sa classe : le
-- nom unique par (branche, nom, classe) de 0014 ne suffit plus avec un
-- branche_id NULL (Postgres DISTINCT NULLS, une seule fois par classe).
-- NULLS NOT DISTINCT handles the NULL branche_id: (NULL, nom, classe) est
-- unique une seule fois. L'index de 0014 couvre déjà ce cas.

-- Index utile au tri du catalogue : les matières sans branche d'abord.
create index idx_sous_branches_no_branch
  on public.sous_branches (name, classe_id)
  where branche_id is null;
