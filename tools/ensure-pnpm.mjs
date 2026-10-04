const userAgent = process.env.npm_config_user_agent ?? '';

if (!userAgent.startsWith('pnpm/')) {
  console.error('本项目只允许使用 pnpm。请运行：corepack enable && pnpm install');
  process.exit(1);
}
