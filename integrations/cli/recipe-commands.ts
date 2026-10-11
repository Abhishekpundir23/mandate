import type { CliCommand } from './args';
import type { CommandResult } from './commands';
import { readBoundedFile } from './io';
import { capabilityInventory, compileRecipe, parseRecipe, previewRecipe, recipeFromScenario, serializeRecipe } from '../../src/authoring';
import { scenarioCatalog } from '../../src/scenarios/catalog';
export async function executeRecipeCommand(input: CliCommand): Promise<CommandResult> {
  if (input.command === 'capabilities') return { code: 0, value: capabilityInventory() };
  if (input.command === 'example') {
    const scenario = scenarioCatalog.find((item) => item.id === input.options['scenario-id']);
    if (scenario === undefined) throw new Error('UNKNOWN_SCENARIO');
    const recipe = recipeFromScenario(scenario); return { code: 0, value: recipe, json: serializeRecipe(recipe) };
  }
  const recipe = parseRecipe(await readBoundedFile(input.options.recipe!, 256 * 1024));
  const scenario = compileRecipe(recipe);
  if (input.command === 'validate') return { code: 0, value: { valid: true, scenarioId: scenario.id, executionPerformed: false } };
  if (input.command === 'compile') return { code: 0, value: scenario };
  return { code: 0, value: previewRecipe(recipe) };
}
