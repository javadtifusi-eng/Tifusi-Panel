import { createContext, useContext, useState, type ReactNode } from 'react'
import { dict, type Dict, type Lang } from './dict'

const STORAGE_KEY = 'tifusi_lang'

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'fa') return saved
  } catch {
    // localStorage unavailable; fall back to the default below.
  }
  return 'fa'
}

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Dict
  dir: 'rtl' | 'ltr'
  align: 'text-right' | 'text-left'
}

const LangContext = createContext<LangContextValue | null>(null)

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang)

  function setLang(next: Lang) {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // localStorage unavailable; the choice just won't persist across reloads.
    }
  }

  const value: LangContextValue = {
    lang,
    setLang,
    t: dict[lang],
    dir: lang === 'fa' ? 'rtl' : 'ltr',
    align: lang === 'fa' ? 'text-right' : 'text-left',
  }

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within a LangProvider')
  return ctx
}
