const campusIndex = { 台北分部: 1, 線上分部: 2, 不確定: 3, 台中分部: 4 };

export const convertCampusStringToIndex = (sqlResult) => {
  return sqlResult.map((r) => ({
    ...r,
    campus: campusIndex[r.campus],
  }));
};
