/**
 * Texte d'un champ de nœud. React Flow applique `updateNodeData` en différé (file traitée
 * après le rendu) : un champ qui affiche directement `data` peut se redessiner une fois
 * avec l'ancien texte, et le curseur saute alors à la fin. Le champ garde donc son texte
 * à lui, mis à jour à chaque frappe, et le transmet au nœud ; il ne reprend `data` que
 * lorsqu'il n'est pas en cours d'édition (modification venue d'ailleurs).
 */
import { useEffect, useRef, useState } from 'react'

export function useDraft(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  // En cours d'édition : le champ garde la molette (classe nowheel), sinon elle déplace le canvas.
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  return {
    value: draft,
    focused,
    onChange: (v: string) => {
      setDraft(v)
      commit(v)
    },
    onFocus: () => {
      editing.current = true
      setFocused(true)
    },
    onBlur: () => {
      editing.current = false
      setFocused(false)
    },
  }
}
