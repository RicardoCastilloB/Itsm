// Funciones de validación
exports.validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

exports.validateRequired = (fields, data) => {
  const errors = [];
  
  fields.forEach(field => {
    if (!data[field]) {
      errors.push(`El campo ${field} es requerido`);
    }
  });
  
  return errors.length > 0 ? errors : null;
};

exports.sanitizeInput = (input) => {
  return typeof input === 'string' ? input.trim() : input;
};
