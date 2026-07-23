/**
 * Settings: the /lang command (direct args + argument completions), the
 * interactive settings menu (styled like pi's built-in /settings), the status
 * bar, and the context/model cache-mismatch warning.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { getSelectListTheme, getSettingsListTheme } from '@earendil-works/pi-coding-agent'
import {
  Container,
  Input,
  type SelectItem,
  SelectList,
  type SettingItem,
  SettingsList,
  Text
} from '@earendil-works/pi-tui'
import { loadConfig, saveConfig } from './config.ts'
import { matchModelReference } from './core.ts'
import type { Config } from './core.ts'

export const STATUS_KEY = 'language-learn'

/** Refresh the persistent status-bar segment from config. */
export function updateStatus(ctx: ExtensionContext, cfg: Config): void {
  if (!ctx.hasUI) return
  const parts: string[] = []
  if (!cfg.enabled) parts.push('✏ lang off')
  if (cfg.auto) parts.push('🌐 auto')
  ctx.ui.setStatus(STATUS_KEY, parts.length > 0 ? parts.join('  ') : undefined)
}

/** Warn when a model override defeats the whole point of context mode. */
export function warnOnCacheMismatch(ctx: ExtensionContext, cfg: Config): void {
  if (!cfg.context || !cfg.model || cfg.model === 'default' || !ctx.model) return
  const sessionModel = `${ctx.model.provider}/${ctx.model.id}`
  if (cfg.model === sessionModel) return
  ctx.ui.notify(
    `/lang model is ${cfg.model} but the session model is ${sessionModel} — context-mode translations can't reuse the session's prompt cache, so the whole history is re-billed at full input price on every translation, and the entire conversation (not just the translated text) is sent to ${cfg.model}'s provider. Run "/lang model default" to follow the session model.`,
    'warning'
  )
}

const LANG_USAGE =
  'Usage: /lang  (settings menu)  |  /lang on|off  |  /lang auto|context on|off  |  /lang native|learning <code>  |  /lang model <provider/id|id|default>'

const LANGUAGE_PRESETS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' }
]
const CUSTOM_LANG = '__custom__'

const LANG_VALUE_COMPLETIONS: Record<string, string[]> = {
  auto: ['on', 'off'],
  context: ['on', 'off'],
  native: ['zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'en'],
  learning: ['en', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru'],
  model: ['default']
}

export interface SettingsDeps {
  /** Abort any in-flight writing check and hide its widget (check turned off). */
  disableGrammar(ctx: ExtensionContext): void
}

/** Register the /lang command, its settings menu, and the session_start status/warning. */
export function registerLangSettings(pi: ExtensionAPI, deps: SettingsDeps): void {
  /** Apply a `check`/`auto`/`context` toggle; shared by the menu and the direct command. */
  const applyToggle = (
    ctx: ExtensionContext,
    cfg: Config,
    key: 'check' | 'auto' | 'context',
    on: boolean
  ) => {
    if (key === 'check') {
      cfg.enabled = on
      if (!on) deps.disableGrammar(ctx)
    } else if (key === 'auto') {
      cfg.auto = on
      if (on && !cfg.model) {
        ctx.ui.notify(
          'auto mode uses the session model — consider a cheaper one, e.g. /lang model anthropic/claude-haiku-4-5',
          'info'
        )
      }
    } else {
      cfg.context = on
      if (on) warnOnCacheMismatch(ctx, cfg)
    }
    saveConfig(cfg)
    updateStatus(ctx, cfg)
  }

  /** Interactive settings menu, styled like pi's built-in /settings. */
  const openSettingsMenu = async (ctx: ExtensionContext, cfg: Config) => {
    await ctx.ui.custom((tui, theme, _kb, done) => {
      /** Submenu: preset languages via SelectList, plus a free-form "custom…" entry. */
      const languageSubmenu = (
        title: string,
        currentValue: string,
        submenuDone: (value?: string) => void
      ) => {
        let mode: 'list' | 'input' = 'list'

        const options: SelectItem[] = [
          ...LANGUAGE_PRESETS.map((p) => ({ value: p.code, label: p.code, description: p.name })),
          {
            value: CUSTOM_LANG,
            label: 'custom…',
            description: 'Type any language code (e.g. it, vi, th)'
          }
        ]
        const list = new SelectList(options, options.length, getSelectListTheme())
        const preselect = options.findIndex((o) => o.value === currentValue)
        if (preselect >= 0) list.setSelectedIndex(preselect)

        const input = new Input()
        input.focused = true
        input.onSubmit = (value) => {
          const code = value.trim()
          if (code) submenuDone(code)
        }
        input.onEscape = () => {
          mode = 'list'
        }

        list.onSelect = (item) => {
          if (item.value === CUSTOM_LANG) {
            mode = 'input'
          } else {
            submenuDone(item.value)
          }
        }
        list.onCancel = () => submenuDone(undefined)

        return {
          render: (width: number) => [
            theme.fg('accent', theme.bold(` ${title}`)),
            '',
            ...(mode === 'list'
              ? list.render(width)
              : [
                  theme.fg('muted', ' Language code (enter to confirm, esc to go back):'),
                  ...input.render(width)
                ])
          ],
          invalidate: () => {},
          handleInput: (data: string) => {
            if (mode === 'list') {
              list.handleInput(data)
            } else {
              input.handleInput(data)
            }
          }
        }
      }

      /** Submenu: models with configured auth (same source as the built-in /model selector). */
      const modelSubmenu = (currentValue: string, submenuDone: (value?: string) => void) => {
        const options: SelectItem[] = [
          { value: 'default', label: 'default', description: 'follow the session model' },
          ...ctx.modelRegistry.getAvailable().map((m) => ({
            value: `${m.provider}/${m.id}`,
            label: `${m.provider}/${m.id}`,
            description: m.name
          }))
        ]
        const list = new SelectList(options, Math.min(options.length, 10), getSelectListTheme())
        const preselect = options.findIndex((o) => o.value === currentValue)
        if (preselect >= 0) list.setSelectedIndex(preselect)
        list.onSelect = (item) => submenuDone(item.value)
        list.onCancel = () => submenuDone(undefined)
        return {
          render: (width: number) => [
            theme.fg('accent', theme.bold(' Model')),
            '',
            ...list.render(width)
          ],
          invalidate: () => {},
          handleInput: (data: string) => list.handleInput(data)
        }
      }

      const items: SettingItem[] = [
        {
          id: 'check',
          label: 'Writing check',
          currentValue: cfg.enabled ? 'on' : 'off',
          values: ['on', 'off'],
          description: 'Review your prompts for spelling and grammar while the agent works'
        },
        {
          id: 'auto',
          label: 'Auto-translate',
          currentValue: cfg.auto ? 'on' : 'off',
          values: ['on', 'off'],
          description: 'Translate every final assistant response automatically'
        },
        {
          id: 'context',
          label: 'Translation context',
          currentValue: cfg.context ? 'on' : 'off',
          values: ['on', 'off'],
          description:
            "Let translations see the whole conversation (better terms and referents). Reuses the session's prompt cache — keep Model on default, or the history is re-billed at full price"
        },
        {
          id: 'native',
          label: 'Native language',
          currentValue: cfg.native,
          description: 'Translation target and explanation language',
          submenu: (current, submenuDone) =>
            languageSubmenu('Native language', current, submenuDone)
        },
        {
          id: 'learning',
          label: 'Learning language',
          currentValue: cfg.learning,
          description: 'The language you are practicing',
          submenu: (current, submenuDone) =>
            languageSubmenu('Learning language', current, submenuDone)
        },
        {
          id: 'model',
          label: 'Model',
          currentValue: cfg.model ?? 'default',
          description:
            'Model used for checks and translations — "default" follows the session model',
          submenu: (current, submenuDone) => modelSubmenu(current, submenuDone)
        }
      ]

      const container = new Container()
      container.addChild(new Text(theme.fg('accent', theme.bold('✏ Language learning')), 1, 0))
      const list = new SettingsList(
        items,
        items.length + 2,
        getSettingsListTheme(),
        (id, newValue) => {
          if (id === 'check' || id === 'auto' || id === 'context') {
            applyToggle(ctx, cfg, id, newValue === 'on')
          } else if (id === 'native' || id === 'learning') {
            cfg[id] = newValue
            saveConfig(cfg)
          } else if (id === 'model') {
            cfg.model = newValue === 'default' ? undefined : newValue
            saveConfig(cfg)
            if (cfg.model) warnOnCacheMismatch(ctx, cfg)
          }
        },
        () => done(undefined)
      )
      container.addChild(list)

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          list.handleInput?.(data)
          tui.requestRender()
        }
      }
    })
  }

  pi.registerCommand('lang', {
    description:
      'Language learning: /lang opens the settings menu; /lang <key> <value> sets directly',
    getArgumentCompletions: (prefix) => {
      const argMatch = prefix.match(/^(\S+)\s+(\S*)$/)
      if (argMatch) {
        const [, key, partial] = argMatch
        const values = (LANG_VALUE_COMPLETIONS[key] ?? []).filter((v) =>
          v.toLowerCase().startsWith(partial.toLowerCase())
        )
        return values.length > 0 ? values.map((v) => ({ value: `${key} ${v}`, label: v })) : null
      }
      const keys = ['on', 'off', 'auto', 'context', 'native', 'learning', 'model'].filter((k) =>
        k.startsWith(prefix.trim().toLowerCase())
      )
      return keys.length > 0
        ? keys.map((k) => ({ value: k === 'on' || k === 'off' ? k : `${k} `, label: k }))
        : null
    },
    handler: async (args, ctx) => {
      const cfg = loadConfig()
      const [sub, value] = args.trim().split(/\s+/).filter(Boolean)

      const show = () =>
        ctx.ui.notify(
          `learning=${cfg.learning}  native=${cfg.native}  model=${cfg.model ?? 'default (session model)'}  check=${cfg.enabled ? 'on' : 'off'}  auto=${cfg.auto ? 'on' : 'off'}  context=${cfg.context ? 'on' : 'off'}`,
          'info'
        )

      if (!sub) {
        if (ctx.hasUI && ctx.mode === 'tui') {
          await openSettingsMenu(ctx, cfg)
        } else {
          show()
        }
        return
      }

      switch (sub) {
        case 'on':
        case 'off':
          applyToggle(ctx, cfg, 'check', sub === 'on')
          break
        case 'auto':
        case 'context':
          if (value !== 'on' && value !== 'off') {
            ctx.ui.notify(`Usage: /lang ${sub} on|off`, 'warning')
            return
          }
          applyToggle(ctx, cfg, sub, value === 'on')
          break
        case 'native':
        case 'learning':
          if (!value) {
            ctx.ui.notify(`Usage: /lang ${sub} <language code, e.g. en, zh-CN, ja>`, 'warning')
            return
          }
          cfg[sub] = value
          saveConfig(cfg)
          updateStatus(ctx, cfg)
          break
        case 'model':
          if (!value) {
            ctx.ui.notify(
              'Usage: /lang model <provider/id>, a unique model id, or default',
              'warning'
            )
            return
          }
          if (value === 'default') {
            cfg.model = undefined
          } else {
            const match = matchModelReference(value, ctx.modelRegistry.getAll())
            if (match.kind === 'ambiguous') {
              const refs = match.candidates.map((m) => `${m.provider}/${m.id}`).join(', ')
              ctx.ui.notify(`Ambiguous model id: ${value} — use one of: ${refs}`, 'warning')
              return
            }
            if (match.kind === 'none') {
              ctx.ui.notify(
                `Model not found: ${value} (expected <provider>/<id> or a unique model id)`,
                'warning'
              )
              return
            }
            const found = match.model
            const hasAuth = ctx.modelRegistry
              .getAvailable()
              .some((m) => m.provider === found.provider && m.id === found.id)
            if (!hasAuth) {
              ctx.ui.notify(
                `No auth configured for ${value} — run /login ${found.provider} first`,
                'warning'
              )
              return
            }
            cfg.model = `${found.provider}/${found.id}`
            warnOnCacheMismatch(ctx, cfg)
          }
          saveConfig(cfg)
          updateStatus(ctx, cfg)
          break
        default:
          ctx.ui.notify(LANG_USAGE, 'warning')
          return
      }

      show()
    }
  })

  pi.on('session_start', (_event, ctx) => {
    const cfg = loadConfig()
    updateStatus(ctx, cfg)
    warnOnCacheMismatch(ctx, cfg)
  })

  // Switching the session model mid-session (/model) can also create the mismatch.
  pi.on('model_select', (_event, ctx) => {
    warnOnCacheMismatch(ctx, loadConfig())
  })
}
