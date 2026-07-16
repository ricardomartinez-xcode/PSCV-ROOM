# Design QA — nombres de materiales

- Source visual truth path: `C:/Users/ricar/AppData/Local/Temp/codex-clipboard-7a68dcb1-5d51-468d-bbd5-f0800b95e8e8.png`
- Implementation screenshot path: `C:/Users/ricar/AppData/Local/Temp/pscv-material-name-after-mobile-focus.png`
- Focused implementation crop: `C:/Users/ricar/AppData/Local/Temp/pscv-material-name-after-mobile-focus-crop.png`
- Combined comparison evidence: `C:/Users/ricar/AppData/Local/Temp/pscv-material-name-comparison.png`
- Viewport: 390 × 844 CSS px
- State: formulario “Nueva tarea”, dos materiales R2 seleccionados

## Findings

- No hay diferencias P0, P1 o P2 atribuibles al cambio. Los UUID dejaron de aparecer en títulos, nombres secundarios, etiquetas seleccionadas y nombres accesibles.
- El identificador continúa almacenado en `r2_key`, `file_name` y el registro interno; solamente se transforma la presentación.

## Full-view comparison evidence

La captura completa confirma que el selector, los dos resultados, el contador, las etiquetas de selección y los botones de quitar permanecen visibles y operables en móvil. No existe overflow horizontal del documento (`scrollWidth === clientWidth`).

## Focused region comparison evidence

La comparación combinada muestra el mismo lenguaje visual de píldoras, borde, color y control de cierre. La única diferencia intencional es la eliminación del UUID inicial; quedan “sesion 17 18 dinamizando los grupos 1” y “sesion 21 tecnicas grupales”. No fue necesaria otra región enfocada porque el cambio solo afecta el texto de este componente.

## Required fidelity surfaces

- Fonts and typography: se conservaron familia, peso, tamaño, truncado y wrapping existentes.
- Spacing and layout rhythm: las etiquetas se contraen con el nombre legible y se apilan correctamente a 390 px.
- Colors and visual tokens: sin cambios.
- Image quality and asset fidelity: no se añadieron ni modificaron imágenes o iconos.
- Copy and content: se conserva el nombre del documento; se oculta únicamente el identificador técnico.

## Interaction and console checks

- Se seleccionaron dos materiales mediante sus checkboxes.
- Se quitó “sesion 21 tecnicas grupales” desde su botón y se volvió a seleccionar.
- Los nombres accesibles de los controles tampoco contienen UUID.
- Errores de consola: 0.

## Comparison history

1. Referencia: ambos chips mostraban el UUID del objeto antes del nombre.
2. Corrección: se agregó una función de presentación compartida y se aplicó en Tareas, Materiales y Admin sin modificar las claves internas.
3. Evidencia posterior: comparación combinada y captura móvil sin UUID; no quedaron hallazgos P0/P1/P2.

## Follow-up polish

No hay ajustes P3 necesarios para este cambio puntual.

final result: passed
