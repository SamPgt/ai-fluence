import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '@/components/layout/PageHeader'

export const Route = createFileRoute('/_app/aide')({
  component: HelpPage,
})

/**
 * Aide : temps de génération mesurés, modèle conseillé selon la situation, et les comparatifs faits pendant le
 * développement (planches dans `public/aide`). Pour ne pas se reposer les mêmes questions d'un jour à l'autre.
 * Mesures sur RTX 3060 12 Go, 32 Go de RAM, ComfyUI lancé avec `--reserve-vram 1.5`.
 */

const SECTIONS = [
  { id: 'temps', label: 'Temps de génération' },
  { id: 'choisir', label: 'Quel modèle pour quoi' },
  { id: 'detail', label: 'Respect des détails (texte seul)' },
  { id: 'rue', label: 'Photo de rue façon Instagram' },
  { id: 'qwen', label: 'Qwen-Image 2512 et Lightning' },
  { id: 'decor', label: 'Personnage dans une vraie photo' },
  { id: 'retouche', label: 'Retouche et correction auto' },
  { id: 'planche', label: 'Planche de références' },
  { id: 'video', label: 'Vidéo : versions de LTX' },
  { id: 'voix', label: 'Voix' },
  { id: 'memoire', label: 'Mémoire, compression, vitesse' },
  { id: 'licences', label: 'Licences' },
]

function HelpPage() {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <>
      <PageHeader>
        <span className="text-sm font-medium">Aide · temps et comparatifs des modèles</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1100px] gap-8 px-6 py-6">
          {/* Sommaire */}
          <nav className="sticky top-6 hidden h-fit w-56 shrink-0 space-y-1 lg:block">
            <p className="pb-2 text-xs font-semibold text-muted-foreground">Sommaire</p>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => go(s.id)}
                className="block w-full rounded-md px-2 py-1 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {s.label}
              </button>
            ))}
          </nav>

          <article className="min-w-0 flex-1 space-y-10 pb-24 text-sm leading-relaxed">
            <p className="text-muted-foreground">
              Mesures faites en local sur <b>RTX 3060 12 Go</b> et 32 Go de RAM, d'octobre 2026. Les temps comptent le calcul ;
              le premier lancement d'un modèle ajoute 1 à 3 min de chargement depuis le disque.
            </p>

            <Section id="temps" title="Temps de génération">
              <h3 className="font-semibold">Images (~1 Mpx)</h3>
              <Table
                head={['Modèle', 'Texte seul', 'Avec références', 'Remarque']}
                rows={[
                  ['FLUX.2 klein 4B', '8–15 s', '15–40 s (1 à 3 réf.)', 'Le plus rapide ; le moins réaliste (peau lisse, anatomie fragile)'],
                  ['FLUX.2 klein 9B', '20–45 s', '50 s–1 min 30', 'Le meilleur pour suivre une consigne et des références'],
                  ['Z-Image Turbo', '15–45 s', 'image → image', 'Réaliste, visages variés ; bouton « Réalisme »'],
                  ['Krea 2 Turbo', '1 min–1 min 20', 'image → image', 'Le plus réaliste en photo de rue ; ignore les petits détails'],
                  ['Qwen Edit 2511', '—', '1–2 min 15', 'Retouche d’une image ; remplace souvent le décor'],
                  ['Qwen-Image 2512', '~8 min (25 ét.)', 'image → image', 'Lightning 8 étapes : 1 min 30–2 min ; 4 étapes : ~1 min'],
                ]}
              />
              <h3 className="pt-2 font-semibold">Retouches et outils</h3>
              <Table
                head={['Outil', 'Temps', 'Remarque']}
                rows={[
                  ['Retouche au pinceau (klein 9B)', '45 s–1 min', 'Seule la zone peinte change'],
                  ['Correction auto (visages, mains, pieds)', '~45 s par zone', 'Détection ~1 s, zones à confirmer'],
                  ['Décrire une image (JoyCaption)', '~35 s', 'Prompt inversé'],
                  ['Planche de références (6 images, klein 9B)', '~5 min', '~50 s par image'],
                ]}
              />
              <h3 className="pt-2 font-semibold">Vidéo et voix</h3>
              <Table
                head={['Quoi', 'Temps', 'Remarque']}
                rows={[
                  ['LTX 2.3, 512p', '~40 s par seconde de vidéo', '4 s ≈ 5 min ; 15 s (une passe) ≈ 9 min 20'],
                  ['LTX 2.3, 720p', '~1 min 20 par seconde', '7 s ≈ 8–10 min ; 15 s (2 clips) ≈ 18–24 min'],
                  ['Wan 2.2, 480p', '3 s ≈ 4 min 30 ; 5 s ≈ 7 min', '720p : 5 s ≈ 22 min ; muet'],
                  ['Création d’une voix (LTX, ~10 s de parole)', '512p ≈ 8 min ; 720p ≈ 13–16 min (estimé)', 'Une fois par personnage'],
                  ['Chatterbox (voix d’une phrase)', '~5 s', '~20 s au premier essai (chargement)'],
                ]}
              />
            </Section>

            <Section id="choisir" title="Quel modèle pour quoi">
              <Table
                head={['Situation', 'Modèle conseillé', 'Pourquoi']}
                rows={[
                  ['Créer un personnage unique (prompt riche en traits)', 'klein 9B, puis retouche des détails', 'Il respecte le plus de traits ; le pinceau pose un grain de beauté où on veut'],
                  ['Photo réaliste à partir d’un texte', 'Krea 2 ou Z-Image', 'Rendu photo le plus crédible'],
                  ['Pose ou composition précise', 'Qwen-Image 2512 en Lightning 8 étapes', 'Suit la pose à la lettre, ~2 min'],
                  ['Le personnage, avec ses références', 'klein 9B', 'Garde le visage sous tous les angles'],
                  ['Le personnage dans une vraie photo', 'klein 9B (« Placer » sur la photo jointe)', 'Garde la photo à l’identique'],
                  ['Réparer une main, un pied, un visage', '« Corriger » ou « Retoucher » (visionneuse)', 'klein refait la zone, le reste ne bouge pas'],
                  ['Rendre une image plus naturelle', 'Z-Image « Réalisme » ou Krea en image → image (0,2–0,3)', 'Peau et lumière plus vraies'],
                  ['Vidéo parlée', 'LTX 2.3 + voix du personnage', 'Synchro labiale correcte ; 512p pour tester, 720p pour garder'],
                ]}
              />
            </Section>

            <Section id="detail" title="Respect des détails (texte seul)" date="13 octobre 2026">
              <p>
                Même prompt chargé en signes distinctifs (Syrienne de 20 ans, sans maquillage, athlétique, grain de beauté
                au-dessus de la lèvre, cicatrice au menton, taches de rousseur, queue de cheval basse…), 3 graines identiques.
              </p>
              <Figure src="/aide/syrienne-4-modeles.jpg" caption="De haut en bas : klein 9B, Z-Image, Krea 2, klein 4B." />
              <Verdict>
                <b>klein 9B</b> respecte le plus de détails (taches, cicatrice, tenue). <b>Krea 2</b> les ignore presque tous et fait
                des « clones » d’une graine à l’autre. <b>Z-Image</b> donne les visages les plus variés. Aucun modèle ne place un
                petit détail à un endroit précis : pour ça, la retouche au pinceau.
              </Verdict>
            </Section>

            <Section id="rue" title="Photo de rue façon Instagram" date="14 octobre 2026">
              <p>Shibuya la nuit, cheveux roses, haut noir, jupe tigre, mains sous le menton (inspiré de fit_aitana).</p>
              <Figure src="/aide/rue-shibuya.jpg" caption="De haut en bas : Qwen-Image 2512 (25 étapes), Z-Image, klein 9B, Krea 2." />
              <Verdict>
                <b>Krea 2</b> est le plus proche d’une vraie photo (néons, enseignes), en ~1 min. <b>Qwen-Image</b> respecte la pose à
                la lettre. Z-Image et klein 9B changent la pose ; Z-Image « asiatise » le visage.
              </Verdict>
            </Section>

            <Section id="qwen" title="Qwen-Image 2512 et Lightning" date="14 octobre 2026">
              <Figure src="/aide/qwen-image-lightning.jpg" caption="25 étapes (~8 min) contre Lightning 8 étapes (~1 min 30–2 min) et 4 étapes (~1 min)." />
              <Verdict>
                <b>Lightning 8 étapes</b> : 4 à 5 fois plus rapide, et plutôt plus naturel. 50 étapes (le réglage officiel) n’apporte
                rien pour le double de temps. En Lightning, le prompt négatif ne sert plus.
              </Verdict>
              <Figure src="/aide/qwen-image-creations.jpg" caption="Créations en Lightning 8 étapes : selfie au réveil, sortie de salle de sport sous la pluie." />
            </Section>

            <Section id="decor" title="Personnage dans une vraie photo" date="14 octobre 2026">
              <p>Photo libre de droits (CC0) d’une ruelle avec terrasse ; Nadia assise, robe blanche, café.</p>
              <Figure src="/aide/personnage-dans-photo.jpg" caption="En haut : la photo, klein 9B, klein 4B, Qwen Edit. En bas : Z-Image + visage, Krea 2, Qwen-Image 2512." />
              <Verdict>
                <b>klein 9B</b> garde la vraie photo à l’identique et y place le personnage avec la bonne lumière : c’est le plus
                réaliste, puisque le décor est réel. Qwen Edit remplace la ruelle ; les modèles sans références la réinventent et
                perdent le personnage. Dans le composer : joindre la photo, puis « Placer ».
              </Verdict>
            </Section>

            <Section id="retouche" title="Retouche et correction auto" date="13 et 14 octobre 2026">
              <Figure src="/aide/retouche-main-verre.jpg" caption="Main effacée puis refaite de zéro par klein 9B (à gauche l’original)." />
              <Figure src="/aide/retouche-main-pareo.jpg" caption="Même chose sur une main posée sur un paréo : original, klein 9B, Qwen Edit." />
              <Verdict>
                Z-Image (même méthode) donnait une main vieillie à la peau fausse ; <b>klein 9B</b> est le meilleur, ~1 min.
              </Verdict>
              <Figure src="/aide/correction-variantes.jpg" caption="Correction d’un pied raté et d’un sac pris pour une main : sans référence, référence floutée, référence grise." />
              <Verdict>
                Pour les mains et les pieds, la <b>référence floutée</b> gagne : couleurs et volumes gardés (sandales en cuir brun),
                défaut oublié. Sans référence : pied et main géants. Le détecteur se trompe parfois (un sac vu comme une main, même
                avec une forte confiance) : on décoche la zone avant de corriger.
              </Verdict>
              <Figure src="/aide/correction-resultat.jpg" caption="Correction automatique, sac décoché : la vraie main refaite, les pieds rattachés avec leurs sandales en cuir brun (~2 min 30 pour 3 zones)." />
            </Section>

            <Section id="planche" title="Planche de références" date="13 octobre 2026">
              <Figure src="/aide/planche-references.jpg" caption="klein 9B à partir de l’avatar : 2 faces, 2 trois-quarts, 2 profils (~50 s chacune)." />
              <Verdict>Même visage sur toutes les poses ; les 3 images retenues sont jointes d’office aux modèles à références.</Verdict>
            </Section>

            <Section id="video" title="Vidéo : versions de LTX" date="14 octobre 2026">
              <p>15 s en 720p, même image, prompt, graine et voix : Q4_K_M (Unsloth), q4km (Civitai), Q5_K_M (Unsloth).</p>
              <Figure src="/aide/ltx-versions.jpg" caption="Une image à 1, 4, 8, 11 et 14 s de chaque vidéo." />
              <Verdict>
                Les trois sont très proches ; la vitesse par étape est la même (Q5 un poil plus lente). Les écarts de temps total
                venaient du rechargement de Gemma entre les clips, supprimé depuis (tous les passages du prompt sont encodés au
                début). Q5 : un peu plus de finesse possible, ~2 Go de plus à relire depuis la RAM.
              </Verdict>
            </Section>

            <Section id="voix" title="Voix">
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  La voix est créée une fois par LTX à partir de l’image du personnage, puis réutilisée par Chatterbox. LTX invente
                  une voix assortie à l’image : <b>l’accent vient de lui</b> (une voix créée en anglais a pris un accent des îles).
                  Préciser l’accent dans « Décris sa voix » (« natural French accent from Paris ») ou importer un extrait audio.
                </li>
                <li>Création en 720p : voix peut-être plus fidèle, 2 fois plus longue. En 256p, la voix sortait robotique.</li>
                <li>Pauses exactes : <code>[2s]</code> dans le « Texte dit ». Expressivité réglable pour chaque vidéo dans le composer.</li>
                <li>Chatterbox ajoutait parfois un souffle ou un « boum » en fin de phrase : coupés automatiquement.</li>
              </ul>
            </Section>

            <Section id="memoire" title="Mémoire, compression, vitesse">
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <b>VRAM</b> : 12 Go, dont ~1,5 Go réservés et plusieurs Go de mémoire de travail (surtout en vidéo 720p). Un modèle
                  plus gros (LTX : 14 Go) garde une partie de ses poids en RAM, relue à chaque étape : c’est plus lent mais régulier.
                  Avant un modèle qui ne trouve pas sa place, l’app vide la carte.
                </li>
                <li>
                  <b>RAM</b> (32 Go) : si elle déborde, Windows passe sur le disque et tout ralentit fortement (une vidéo de 10 à
                  21 min). L’app décharge les modèles quand la RAM libre ne suffit pas.
                </li>
                <li>
                  <b>Compression GGUF</b> : Q8 &gt; Q6 &gt; Q5 &gt; Q4 &gt; Q3 &gt; Q2 (fidélité). Les écarts se voient surtout sous Q4
                  (détails pâteux, scintillement). K_M légèrement meilleur que K_S à taille voisine.
                </li>
                <li>
                  <b>Distilled / Lightning</b> : 4 à 8 étapes au lieu de 25 à 50, sans prompt négatif. Dev (LTX) : 8 à 10 fois plus
                  lent.
                </li>
                <li>Modèles et variantes : Paramètres → Modèles locaux (type de chaque fichier, fichiers cachés).</li>
              </ul>
            </Section>

            <Section id="licences" title="Licences">
              <Table
                head={['Modèles', 'Usage commercial']}
                rows={[
                  ['Z-Image, Qwen Edit, Qwen-Image 2512, klein 4B, Wan', 'Oui (Apache 2.0)'],
                  ['klein 9B', 'Probablement non (licence non commerciale) : à vérifier'],
                  ['Krea 2, LTX', 'Licence communautaire avec un seuil de chiffre d’affaires'],
                ]}
              />
            </Section>
          </article>
        </div>
      </div>
    </>
  )
}

function Section({ id, title, date, children }: { id: string; title: string; date?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="flex items-baseline gap-3 border-b border-border/50 pb-1.5 text-base font-semibold">
        {title}
        {date && <span className="text-xs font-normal text-muted-foreground">testé le {date}</span>}
      </h2>
      {children}
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-[13px]">
        <thead className="bg-secondary/40 text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? 'px-3 py-2 font-medium' : 'px-3 py-2 text-muted-foreground'}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Figure({ src, caption }: { src: string; caption: string }) {
  return (
    <figure className="space-y-1.5">
      <a href={src} target="_blank" rel="noreferrer">
        <img src={src} alt={caption} loading="lazy" className="w-full rounded-lg border border-border/50" />
      </a>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

function Verdict({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border-l-2 border-brand bg-brand/5 px-3 py-2">{children}</p>
}
