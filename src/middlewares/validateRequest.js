module.exports = (schema) => (req, _res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Validation error");
    error.status = 400;
    return next(error);
  }

  req.validated = result.data;
  return next();
};
