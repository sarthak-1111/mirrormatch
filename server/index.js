import { config, llmEnabled } from './config.js';
import { createApp } from './app.js';

const { app, init } = createApp(config, { persistEvents: config.persistEvents });
await init();
app.listen(config.port, config.host, () => {
  console.log(`SecondTry running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`  shopper:  /            merchant dashboard: /merchant`);
  console.log(`  YouCam:   ${config.youcam.mode}${config.youcam.mode === 'mock' ? ' (no YOUCAM_API_KEY; previews are placeholders)' : ''}`);
  console.log(`  LLM:      ${llmEnabled() ? `${config.llm.model} @ ${config.llm.baseUrl}` : 'off (templated text)'}`);
  console.log(`  renders:  max ${config.budget.maxRendersPerReturn}/return, unit floor ${config.budget.unitFloor}, demo cache ${config.demoCache.enabled ? 'ON' : 'off'}`);
});
