
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Llama directamente al endpoint que devuelve el número
    const response = await fetch('/api/equipment/ultra');
    
    // Si la respuesta no es exitosa, lanza error
    if (!response.ok) throw new Error('Error al obtener el número');

    // Como tu endpoint devuelve un número (ej: 3280)
    const total = await response.json();

    // Inserta el número en el elemento HTML
    const elemento = document.getElementById('equipos_ultra');
    if (elemento) {
      elemento.textContent = total;
    } else {
      console.warn("No se encontró el elemento con ID 'usuarios_planilla'");
    }
  } catch (error) {
    console.error('Error al obtener los datos:', error);
  }
});

