// Espera a que se cumpla una condición en vez de dormir un tiempo fijo: con la
// máquina cargada (dos suites a la vez), un tmux real puede tardar más.
export async function esperarA(condicion: () => boolean | Promise<boolean>, ms = 5_000): Promise<void> {
  const limite = Date.now() + ms
  while (!(await condicion())) {
    if (Date.now() > limite) throw new Error('tiempo agotado esperando la condición')
    await new Promise((r) => setTimeout(r, 20))
  }
}
