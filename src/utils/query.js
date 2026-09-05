export const listQuery = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const sortOrder = query.sortOrder === "asc" ? 1 : -1;
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort: { [query.sortBy || "createdAt"]: sortOrder },
  };
};
export const paginated = (items, total, { page, limit }) => ({
  items,
  pagination: { page, limit, total, pages: Math.ceil(total / limit) },
});
