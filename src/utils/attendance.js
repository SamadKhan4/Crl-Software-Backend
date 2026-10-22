export const indiaToday = () => new Date(Date.now()).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
export function calculateAttendance(month, records, holidays, joiningDate, asOf = indiaToday()) {
  const [year, number] = month.split("-").map(Number);
  const calendarDays = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const holidayMap = new Map(holidays.map((row) => [row.date, row.name]));
  const recordMap = new Map(records.map((row) => [row.date, row]));
  const joined = joiningDate ? new Date(joiningDate).toISOString().slice(0, 10) : "";
  let unpaidDays = 0, paidLeaveDays = 0, eligibleDays = 0;
  const calendar = [];
  for (let day = 1; day <= calendarDays; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const sunday = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
    const holiday = holidayMap.get(date);
    const record = recordMap.get(date);
    const future = date > asOf;
    const eligible = (!joined || date >= joined) && !future;
    const off = sunday || Boolean(holiday);
    // Sundays and holidays are paid calendar days, never unpaid leave.
    const status = eligible ? (off ? "PRESENT" : record?.status || "PRESENT") : "";
    if (eligible) {
      eligibleDays++;
      if (["ABSENT", "UNPAID_LEAVE"].includes(status)) unpaidDays++;
      if (status === "HALF_DAY") unpaidDays += 0.5;
      if (status === "PAID_LEAVE") paidLeaveDays++;
    }
    calendar.push({ date, sunday, holiday, future, eligible, status, remarks: record?.remarks || "" });
  }
  return { asOf, calendarDays, workingDays: calendarDays, eligibleDays, unpaidDays, paidLeaveDays, missingDays: 0, paidDays: eligibleDays - unpaidDays, calendar };
}
export const roundMoney = (number) => Math.round((number + Number.EPSILON) * 100) / 100;
export const leaveDeduction = (gross, summary) => summary.calendarDays ? roundMoney(gross * summary.unpaidDays / summary.calendarDays) : 0;
export const prorationDeduction = (gross, summary) => summary.calendarDays ? roundMoney(gross * (summary.calendarDays - summary.eligibleDays) / summary.calendarDays) : 0;
