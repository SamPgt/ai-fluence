# AI Fluence

## Stockage : seules les images sont sur le disque

- L'app sera déployée sur le web. Tout ce qui est sauvegardé doit donc l'être d'une façon qui fonctionne aussi en ligne : en base (Postgres) ou dans le navigateur (cookies, localStorage).
- Seuls les médias (images, vidéos) sont aujourd'hui enregistrés sur le disque local, pour éviter pour l'instant un CDN et son coût. Au passage sur le web, seul ce stockage changera (bascule vers un CDN).
- Ne jamais ajouter d'autre donnée enregistrée en fichiers locaux côté serveur (brouillons, réglages, préférences…).

## Générations de test (payantes)

- Une génération SpicyAPI coûte de l'argent : n'en lancer que pour répondre à une question dont la réponse vient de l'expérience (comportement réel d'un modèle) et ne se trouve pas dans la documentation.
- Toujours demander l'accord dans le chat avant chaque lancement, avec le modèle, les réglages et le prix. Jamais rien d'automatisé, de récurrent ou de fréquent.
- Choisir le moins cher : modèle low cost, résolution la plus basse, une seule image.
- Une fois le test fini, mettre les fils de test à la corbeille.
