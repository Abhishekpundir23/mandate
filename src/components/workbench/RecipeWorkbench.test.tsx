import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { compileRecipe, recipeFromScenario } from '../../authoring/index';
import { scenarioCatalog } from '../../scenarios/catalog';
import { parseLabScenario } from '../../lab/parse';
import { RecipeWorkbench } from './RecipeWorkbench';
test('requires explicit compilation, derives metadata and clears stale preview on edits', () => {
  render(<RecipeWorkbench />);
  expect(screen.queryByLabelText('Compiled scenario JSON')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Compile recipe' }));
  expect((screen.getByLabelText('Compiled scenario JSON') as HTMLTextAreaElement).value).toContain(
    'fingerprint',
  );
  fireEvent.change(screen.getByLabelText('Recipe JSON'), { target: { value: '{}' } });
  expect(screen.queryByLabelText('Compiled scenario JSON')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Compile recipe' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Recipe rejected');
});
test('runs an explicitly compiled recipe through the sandbox', () => {
  render(<RecipeWorkbench />);
  fireEvent.click(screen.getByRole('button', { name: 'Compile recipe' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run compiled scenario' }));
  expect(screen.getByRole('status')).toHaveTextContent('Mandate passed');
});

test('compiled scenario output stays within its import byte limit', () => {
  const recipe = JSON.parse(JSON.stringify(recipeFromScenario(scenarioCatalog[0]!)));
  recipe.initialWorld.padding = '';
  recipe.initialWorld.padding = 'x'.repeat(
    256 * 1024 - JSON.stringify(compileRecipe(recipe)).length - 20,
  );
  render(<RecipeWorkbench />);
  fireEvent.change(screen.getByLabelText('Recipe JSON'), {
    target: { value: JSON.stringify(recipe) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Compile recipe' }));
  const output = (screen.getByLabelText('Compiled scenario JSON') as HTMLTextAreaElement).value;
  expect(() => parseLabScenario(output)).not.toThrow();
});
