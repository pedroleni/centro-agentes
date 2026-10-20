// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from '../src/App'

test('pinta el título del panel', () => {
  render(<App />)
  expect(screen.getByText('Centro de agentes')).toBeTruthy()
})
