export function calculateAttendance(month, records, holidays, joiningDate) {
  const [year, number] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const holidayMap = new Map(holidays.map((row) => [row.date, row.name]));
  const recordMap = new Map(records.map((row) => [row.date, row]));
  const joined = joiningDate ? new Date(joiningDate).toISOString().slice(0, 10) : "";
  let workingDays = 0, unpaidDays = 0, paidLeaveDays = 0, missingDays = 0, eligibleDays = 0;
  const calendar = [];
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    const holiday = holidayMap.get(date);
    const record = recordMap.get(date);
    const working = !sunday && !holiday;
    const eligible = !joined || date >= joined;
    if (working) {
      workingDays++;
      if (eligible) {
        eligibleDays++;

        if (["ABSENT", "UNPAID_LEAVE"].includes(record?.status)) unpaidDays++;
        if (record?.status === "HALF_DAY") unpaidDays += 0.5;
        if (record?.status === "PAID_LEAVE") paidLeaveDays++;
      }
    }
    calendar.push({ date, sunday, holiday, eligible, status: record?.status || (eligible && working ? "PRESENT" : ""), remarks: record?.remarks || "" });
  }
  return { workingDays, eligibleDays, unpaidDays, paidLeaveDays, missingDays, paidDays: eligibleDays - unpaidDays, calendar };
}
export const roundMoney = (number) => Math.round((number + Number.EPSILON) * 100) / 100;
export const leaveDeduction = (gross, summary) => summary.workingDays ? roundMoney(gross * (summary.workingDays - summary.paidDays) / summary.workingDays) : 0;
