import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**', '.superpowers/**', '.codex-logs/**', 'scripts/dev/**', 'web/dist/**'] },
  ...tseslint.configs.recommended,
)
