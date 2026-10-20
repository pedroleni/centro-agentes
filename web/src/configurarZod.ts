import { z } from 'zod'

// zod 4 comprueba si puede usar `eval` para acelerar la validación. La CSP del
// panel lo prohíbe y esa comprobación deja un error en la consola. Este módulo
// se importa el primero, antes de que se carguen los esquemas.
z.config({ jitless: true })
