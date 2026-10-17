---
name: write-commit-long
model: sonnet
description: Variante longue de write-commit pour un gros lot de modifications : même message de commit (titre puis puces Conventional Commits, dans `<racine>/-commits/AAAA-MM-JJ.md`), mais jusqu'à 16 lignes au lieu de 10. À utiliser quand l'utilisateur demande « /write-commit-long », « commit long », « écris le commit en version longue ». Ne commite jamais, ne modifie ni le code ni l'historique.
---

# Écrire un commit long (gros lot de modifications)

Suivre **exactement** le skill `write-commit` (fichier `../write-commit/SKILL.md`, dans le même dossier de skills) : dépôt, analyse, format, rédaction, écriture du fichier et réponse. Une seule règle change :

- **16 lignes au maximum** pour tout le fichier, titre et ligne vide compris (au lieu de 10).

Comment utiliser la place en plus :

- Une puce par fonctionnalité notable, au lieu de les regrouper : le lecteur doit pouvoir retrouver chaque changement important.
- Toujours une seule ligne par puce, et toujours regrouper les petites corrections dans une seule puce `fix`.
- Ne pas remplir pour remplir : si 10 lignes suffisent, en écrire 10.
