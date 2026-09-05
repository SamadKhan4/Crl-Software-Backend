export const success = (res, status, message, data) => res.status(status).json({ success: true, message, data });
export const successPaginated = (res, message, result) =>
  res.status(200).json({
    success: true,
    message,
    data: result.items,
    pagination: { ...result.pagination, totalPages: result.pagination.pages },
  });
