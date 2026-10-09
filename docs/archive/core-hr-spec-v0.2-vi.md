# Core HR – Giai đoạn 1: Hồ sơ nhân sự, thêm mới, cập nhật, nhập/xuất Excel

> **Phiên bản 0.2, ngày 08/10/2026.** v0.1 (07/10/2026) là bản nháp thiết kế. v0.2 áp dụng các sửa đổi R01–R12 và các quyết định phát triển D-01 đến D-16 của bản rà soát PO/TA v2, kiến trúc API v3 và prompt v4, đồng thời ghi lại phần **đã triển khai** ở S0–S3. Các mã D-xx, R-xx, V-xx, S-x và số thứ tự GWT được giữ nguyên để truy vết.
> Ký hiệu trạng thái: **RÕ** = có thể triển khai · **CXN** = cần xác nhận, chưa triển khai · **NPV** = ngoài phạm vi giai đoạn 1.
> Tài liệu liên quan: `docs/adr/0001`–`0004`, `docs/legal/ra-soat-phap-ly-s0-s3.md`, `docs/api/core-hr-api.md`, `contracts/core-hr/openapi.json`.

## Thay đổi v0.2 (tóm tắt)

| Mã | Thay đổi | Nằm ở |
|---|---|---|
| R01 | Hai định dạng Excel: `legacy-v0` (kiểm toạ độ và tiêu đề) và `core-hr-v1` (tên trường duy nhất, cho đổi thứ tự cột, cập nhật chỉ cần mã + trường muốn đổi). File lỗi và file xuất để cập nhật dùng `core-hr-v1` | §8 |
| R02 | Tách mức hoàn thiện hồ sơ (`draft` / `complete` theo checklist) khỏi trạng thái làm việc. Trạng thái được *tính* từ Employment và `employment_event`, không suy ra từ tài khoản, hợp đồng hay ô trống | §2, đã triển khai |
| R03 | Dữ liệu chuyển đổi dạng snapshot: phân công tính từ ngày chụp dữ liệu do HR xác nhận (`record_source = snapshot_import`), không lấy ngày vào làm | §2, §8 |
| R04 | `btree_gist`; FK danh mục; Employment dùng ngày kết thúc *bao gồm*, Assignment dùng `[from, to)`; email công ty duy nhất theo khoảng thời gian được cấp (exclusion constraint, không dùng index theo ngày động); quản lý xét tại ngày hiệu lực | §2, đã triển khai |
| R05 | Idempotency theo người gọi + thao tác (POST tạo hồ sơ, đã triển khai); batch Excel định danh theo batch + dòng | §8 |
| R06 | `person.revision` bao trùm cả dữ liệu con; khoá hàng Person khi sửa | ADR-0004, S4 |
| R07 | Staging/audit cũng là dữ liệu cá nhân. Audit chỉ ghi *tên* trường. Trường nhạy cảm cần mã hoá + chỉ mục HMAC trước khi bật; hiện API từ chối các trường này | ADR-0004, pháp lý |
| R08 | Ngày bất thường chỉ *cảnh báo*; tên có chữ số chỉ cảnh báo; fixture dùng tên `Nhân Viên Thử A`; kiểm tra kiểu giá trị thật của ô; trùng chỉ xét trên giá trị không rỗng | §3 |
| R09 | Xuất XLSX ghi ô kiểu chuỗi và kiểm tra không có công thức; không thêm `'` làm đổi dữ liệu (ví dụ +84) | §8 |
| R10 | Quản lý trong cùng batch được resolve từ staging + DB, ghi theo thứ tự phụ thuộc | §8 |
| R11 | Danh mục có quản trị tạo, sửa, ngừng dùng (không xoá). Vai trò HR_ADMIN, HR_EDITOR (+ HR_VIEWER, API_DOCS_READER cho phát triển) | đã triển khai, ADR-0003 |
| R12 | Leave tool chuyển sang backlog; tách test chưa đăng nhập (401) và thiếu quyền (403) | đã triển khai |

## Trạng thái triển khai S0–S3 (08/10/2026)

**Đã chạy được ở local với PostgreSQL 18.6 và dữ liệu tổng hợp:**
- migration từ DB rỗng;
- REST `/api/v1/core-hr/*` gồm danh mục, danh sách, tạo nháp/đủ dữ liệu và chi tiết;
- UI gọi REST;
- OpenAPI 3.1 nội bộ, xem tại `/internal/docs` khi có quyền `docs.read`;
- test issuer chỉ ở local/test.

**Chưa làm:**
- sửa hồ sơ (S4);
- sự kiện tạm nghỉ, quay lại, kết thúc qua API;
- Excel (S5–S8);
- Entra thật / MSAL;
- tích hợp leave tool;
- nhóm dữ liệu nhạy cảm.

Bằng chứng kiểm thử ghi trong báo cáo bàn giao.

---

## 0. Khảo sát hiện trạng

| Hạng mục | Hiện trạng | Hệ quả |
|---|---|---|
| Repository the project repository | v0.1: trống. **v0.2:** Next.js 16 + TypeScript + PostgreSQL 18 + Prisma 7 (ADR-0001) | DDL ở §2 chỉ còn để minh hoạ lịch sử thiết kế; nguồn chuẩn là `prisma/migrations/`. |
| `template.xlsx` (`~/Downloads/template.xlsx`) | 1 sheet `Sheet1`, **chỉ có dòng tiêu đề** (A1:CK1), không có dòng dữ liệu | Không có dữ liệu thật để suy luận định dạng giá trị. Mọi định dạng giá trị đều là đề xuất. |
| Data validation trong template | Có danh sách thả xuống ở L1 (`Đang làm việc, Nghỉ việc`), S1 (`Fulltime, Probation`) và BH1 (kiểu custom, công thức không hợp lệ). AX1 có validation rỗng. | Các validation này **chỉ gắn vào ô tiêu đề** nên không áp dụng cho dữ liệu. Đây chỉ là quan sát, **không** coi là quy tắc nghiệp vụ, và **không** dùng để diễn giải STATUS/CLASSIFY. |
| Định dạng có điều kiện | Tô trùng giá trị ở B1 (EC) | Gợi ý EC là duy nhất. Cần PO xác nhận (D-03). |
| Định dạng số trong styles | Có `dd/mm/yyyy` và `d/m/yyyy` | Quy ước ngày `dd/mm/yyyy` là hợp lý nhưng chưa có dữ liệu để kiểm chứng. |
| Cột không tiêu đề | Y, CE, CF, CG | Nếu có dữ liệu thì báo cảnh báo và bỏ qua. |
| Tiêu đề trùng tên | `Date/Month/Year` (G–I, AA–AC), `STATUS` (L, T), `DOB` (AD, AZ, BB), `NO.CONTRACT` (U, BG, BL, BQ, BV) | **Ánh xạ phải theo địa chỉ cột kèm kiểm tra tiêu đề**, không theo tên tiêu đề. |
| Leave tool nội bộ | Chưa có tài liệu API, khoá liên kết nhân viên hay danh sách trường | Chưa thiết kế đồng bộ. Mình **không** truy vấn leave tool để tránh đọc dữ liệu nhân sự thật (D-15). |
| Vai trò/quyền, danh mục phòng ban/chức danh/cấp bậc | Chưa có | Xem D-10, D-11. |

---

## 1. Bảng ánh xạ cột nguồn

Quy ước kiểu dữ liệu:
- `text-id`: chuỗi định danh. **Luôn đọc dạng chuỗi và giữ số 0 đầu.** Nếu ô Excel ở dạng số thì báo lỗi, không tự đệm số 0.
- `date`: ô ngày của Excel hoặc chuỗi `dd/mm/yyyy` đúng 10 ký tự.
- `ref`: tra cứu khớp chính xác trong danh mục. Không tự tạo mục mới.

Thực thể đích: **P** = Person, **ID** = giấy tờ tuỳ thân, **E** = Employment (giai đoạn làm việc), **A** = Job Assignment (phân công có ngày hiệu lực), **EC** = mã nhân viên.

| Cột | Tiêu đề nguồn | Trường đích | Kiểu | Quy tắc kiểm tra | Trạng thái |
|---|---|---|---|---|---|
| A | # (Stt) | — (bỏ qua; khi xuất thì đánh số lại) | — | Không đọc | RÕ |
| B | EC (Mã số NV) | `employee_code.code` (source=`legacy`) | text-id | Bắt buộc. Cắt khoảng trắng hai đầu, không đổi hoa/thường. Định dạng chưa biết nên tạm chấp nhận `^[A-Za-z0-9._-]{1,20}$`. Không trùng trong file. Không trùng trong hệ thống khi nhập mới. | RÕ (vai trò). CXN định dạng và việc tái sử dụng mã (D-03) |
| C | FULL NAME (Họ và tên) | `person.full_name` | text | Bắt buộc. Chuẩn hoá Unicode NFC, gộp khoảng trắng, dài 2–150 ký tự, không có chữ số. **Không dùng để ghép người.** | RÕ |
| D | LINK PROFILE | ? | url | — | CXN (D-12) |
| E | CV original | Tài liệu đính kèm | url/file | — | NPV đề xuất (D-12) |
| F | Eme Format | Tài liệu đính kèm | url/file | — | NPV đề xuất (D-12) |
| G, H, I | Date / Month / Year | **Không ánh xạ** | — | Có dữ liệu thì cảnh báo và bỏ qua | CXN (D-05). Không tự diễn giải |
| J | START DAY (Ngày vào) | `employment.start_date`, đồng thời là `assignment.effective_from` ban đầu | date | Bắt buộc khi nhập mới. Nằm trong khoảng 01/01/2000 đến hôm nay + 90 ngày. | RÕ. CXN ngày này tính từ thử việc hay chính thức, và cách xử lý tái tuyển (D-06) |
| K | RESIGN DAY (Ngày nghỉ) | `employment.end_date` | date | Lớn hơn hoặc bằng J | CXN: ngày làm việc cuối cùng hay ngày chấm dứt (D-06) |
| L | STATUS | **Không ánh xạ** | — | Có dữ liệu thì giữ ở bản xem trước để đối chiếu, không ghi | CXN (D-04). Không tự diễn giải |
| M | NOTE | ? | text | — | CXN (D-13): ghi chú gắn với người hay giai đoạn, và có chứa dữ liệu nhạy cảm không |
| N | DEPARTMENT (Phòng Ban) | `assignment.department_id` | ref | Khớp chính xác mã hoặc tên trong danh mục phòng ban | RÕ (cần danh mục, D-11) |
| O | POSITION (Vị trí) | `assignment.position_id` | ref | Khớp `position.name_en` | RÕ (cần danh mục) |
| P | POSITION VIETNAMES (Vị trí) | Kiểm tra chéo với `position.name_vi` | ref | Nếu có giá trị thì phải là tên tiếng Việt của **cùng** chức danh ở O. Lệch thì báo lỗi. | CXN: P có luôn là bản dịch của O không (D-11) |
| Q | Level (Cấp bậc) | `assignment.job_level_id` | ref | Khớp danh mục cấp bậc | RÕ (cần danh mục) |
| R | LINE MANAGER (Quản lý trực tiếp) | `assignment.manager_employment_id` | text-id → ref | **Chỉ nhận mã NV**, mã phải thuộc một giai đoạn làm việc đang hiệu lực. Ghi tên thì báo lỗi, không tra theo tên. Không được tự quản lý chính mình. | CXN: file cũ ghi tên hay mã (D-07) |
| S | CLASSIFY | **Không ánh xạ** | — | Như cột L | CXN (D-04) |
| T | STATUS (Trạng thái) | **Không ánh xạ** | — | Như cột L | CXN (D-04) |
| U–X | Hợp đồng hiện tại (số, loại, ngày ký, ngày hết hạn) | — | — | Bỏ qua ngay khi đọc file và không lưu | **NPV** |
| Y | (trống) | — | — | Có dữ liệu thì cảnh báo | RÕ |
| Z | GENDER (Giới tính) | `person.gender` | enum | Thuộc tập giá trị được duyệt | RÕ trường. CXN tập giá trị (D-11) |
| AA, AB, AC | Date / Month / Year | **Không ánh xạ** | — | Có dữ liệu thì cảnh báo và bỏ qua. Không suy ra DOB từ các cột này. | CXN (D-05) |
| AD | DOB (Ngày sinh) | `person.date_of_birth` | date | Nhỏ hơn hôm nay. Tuổi tại J ≥ 15 (ngưỡng CXN). | RÕ |
| AE | POB (Nơi sinh) | `person.place_of_birth` | text | Tối đa 200 ký tự | RÕ |
| AF | PHONE (Điện thoại) | `person.mobile_phone` | text-id | Bỏ khoảng trắng, dấu `.` và `-`. Chấp nhận `^0\d{9}$` hoặc `^\+84\d{9}$`, lưu dạng `0xxxxxxxxx`. **Không dùng để ghép người.** | RÕ |
| AG | PRIVATE EMAIL (Email cá nhân) | `person.personal_email` | email | RFC cơ bản, chuyển chữ thường. **Không dùng để ghép người.** Trùng với người khác thì chỉ cảnh báo. | RÕ |
| AH | COMPANY EMAIL (Email công ty) | `employment.work_email` | email | Đuôi email thuộc tên miền công ty (D-11). Không trùng giữa các giai đoạn làm việc đang hiệu lực. **Không dùng để ghép người.** | RÕ. CXN đây có phải khoá liên kết với leave tool không (D-15) |
| AI | ID NUMBER (Số CCCD mới) | `identity_document.number` (type=`CCCD`) | text-id | `^\d{12}$`. Không trùng với người khác; trùng thì **chặn** dòng. | RÕ. CXN có nhận CMND 9 số không (D-08) |
| AJ | DAY ISSUED (Ngày cấp) | `identity_document.issued_on` | date | Lớn hơn DOB và nhỏ hơn hoặc bằng hôm nay. Bắt buộc nếu có AI. | RÕ |
| AK | PLACE ISSUED (Nơi cấp) | `identity_document.issued_place` | text | Tối đa 200 ký tự | RÕ |
| AL | LEVEL (Trình độ) | `education.level` | enum | Thuộc danh mục trình độ | RÕ trường. CXN danh mục |
| AM | GRADUATED SCHOOL | `education.school_name` | text | Tối đa 200 ký tự | RÕ |
| AN | MAJOR (Chuyên ngành) | `education.major` | text | Tối đa 200 ký tự | RÕ |
| AO | PIT NUMBER (MST TNCN) | `person.tax_code` | text-id | `^\d{10}$`, `^\d{10}-\d{3}$` hoặc `^\d{12}$` (MST trùng CCCD). Trùng người khác thì chặn. | RÕ. **Nhạy cảm** |
| AP | SI NUMBER (Số sổ BHXH) | `person.social_insurance_no` | text-id | `^\d{10}$`. Trùng người khác thì chặn. | RÕ. **Nhạy cảm** |
| AQ | BANK ACCOUNT NUMBER | `bank_account.account_no` | text-id | `^\d{6,19}$` | CXN: thuộc hồ sơ cơ bản hay payroll (D-09). **Nhạy cảm** |
| AR | BANK (Ngân hàng) | `bank_account.bank_id` | ref | Thuộc danh mục ngân hàng | CXN (D-09) |
| AS | PERMANENT NEW ADDRESS | ? | text | — | CXN (D-14). Không tự diễn giải cũ/mới |
| AT | CONTACT ADDRESS (mới) | ? | text | — | CXN (D-14) |
| AU | PERMANENT ADDRESS | ? | text | — | CXN (D-14) |
| AV | CONTACT ADDRESS | ? | text | — | CXN (D-14) |
| AW | FAMILY STATUS (Tình trạng GĐ) | `person.marital_status` | enum | Thuộc danh mục | RÕ trường. CXN tập giá trị |
| AX | DEPENDENT (Người phụ thuộc) | ? | ? | — | CXN: là số lượng hay danh sách, và có thuộc phạm vi thuế không (D-13) |
| AY, AZ, BA, BB | FIRST/SECOND CHILD + DOB | `family_member` (relation=`child`) | text/date | — | CXN (D-13). Đây là dữ liệu trẻ vị thành niên nên mặc định không nhập |
| BC | PERSON TO CONTACT IN EMERGENCY | `emergency_contact.relationship`? | text | — | CXN: BC là nhãn nhóm hay quan hệ (D-13) |
| BD | NAME | `emergency_contact.full_name` | text | Tối đa 150 ký tự | RÕ |
| BE | PHONE | `emergency_contact.phone` | text-id | Như AF | RÕ |
| BF | SALARY BASIC | — | — | **Bỏ ngay khi đọc. Không lưu vào staging, log hay file gốc.** | **NPV** |
| BG–BZ | 4 khối hợp đồng/phụ lục | — | — | Bỏ ngay khi đọc | **NPV** |
| CA–CD | NO. CONTRACT APPENDIX | — | — | Bỏ ngay khi đọc | **NPV** |
| CE–CG | (trống) | — | — | Có dữ liệu thì cảnh báo | RÕ |
| CH–CK | ID card, Degree, Healthy certification, SYLL | Danh mục hồ sơ giấy đã nộp? | bool? | — | CXN (D-12). Đề xuất NPV |

**Nhận diện bố cục file (template fingerprint):** hệ thống lưu danh sách `(địa chỉ cột → tiêu đề chuẩn hoá)` của bố cục `legacy-v0`. Khi tải lên, chuẩn hoá tiêu đề (bỏ xuống dòng, gộp khoảng trắng, chuyển chữ thường) rồi so khớp **toàn bộ** các cột được ánh xạ. Chỉ cần lệch một cột là từ chối cả file trước khi đọc dữ liệu. Không đoán vị trí cột.

---

## 2. Mô hình dữ liệu: người, giai đoạn làm việc và phân công

```
person 1 ──< employee_code         (mã cũ giữ nguyên; mã nội bộ là person.id, tách riêng)
person 1 ──< identity_document
person 1 ──< employment             (giai đoạn làm việc: vào → nghỉ, có thể tái tuyển)
employment 1 ──< job_assignment     (phòng ban/chức danh/cấp bậc/quản lý theo ngày hiệu lực)
person 1 ──< education | emergency_contact | (family_member, bank_account, address: chờ CXN)
* ──> audit_event ──< audit_field_change      (chỉ ghi thêm, không sửa/xoá)
import_batch 1 ──< import_row                 (staging; chưa phải dữ liệu thật)
```

| Lớp | Nội dung | Thay đổi theo thời gian |
|---|---|---|
| **Con người** (`person`, giấy tờ, học vấn, liên hệ) | Thuộc tính của cá nhân, không phụ thuộc việc họ đang làm hay đã nghỉ | Sửa trực tiếp, mỗi lần sửa ghi `audit_field_change` (giá trị trước/sau, người sửa, lý do, nguồn). |
| **Giai đoạn làm việc** (`employment`) | Một lần vào làm đến lúc nghỉ, kèm email công ty | Tái tuyển thì tạo `employment` mới, giai đoạn cũ giữ nguyên. Các giai đoạn của cùng một người không được chồng lấn. |
| **Phân công** (`job_assignment`) | Phòng ban, chức danh, cấp bậc, quản lý trực tiếp | **Thay đổi thực tế** (điều chuyển, thăng cấp) tạo dòng mới với `effective_from` và đóng dòng trước đó. **Đính chính** (nhập sai) sửa đúng dòng đó và ghi audit kèm lý do. Hai loại này là hai thao tác riêng trên giao diện. |

> **v0.2:** Bản DDL dưới đây là thiết kế v0.1, giữ lại để truy vết. Nguồn chuẩn là `prisma/migrations/20261007000000_init_core_hr/migration.sql`. Những điểm khác v0.1:
> - Mã NV nằm ở `person.employee_code` và sổ `employee_code_registry` (chỉ thêm), không dùng bảng `employee_code` có `is_primary`.
> - Có thêm `app_user`, `app_user_role`, `external_identity`, `employment_event`, `idempotency_record`, và các bảng danh mục có `is_active`.
> - Email công ty dùng exclusion constraint theo khoảng ngày.
> - Phân công phải nằm trong giai đoạn làm việc (constraint trigger trì hoãn).
> - `audit_event.changed_fields` chỉ ghi tên trường, **không** có `audit_field_change` chứa giá trị trước/sau. Nếu S4 cần so sánh giá trị cũ/mới thì phải mã hoá và có chính sách lưu giữ.
> - Chưa tạo các bảng `identity_document`, `education`, `emergency_contact` và staging Excel. Chúng sẽ được tạo khi bật tính năng tương ứng.

DDL minh hoạ v0.1:

```sql
CREATE TABLE person (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- mã nội bộ, ổn định, không hiển thị để sửa
  full_name       text NOT NULL,
  gender          text,
  date_of_birth   date,
  place_of_birth  text,
  mobile_phone    text,       -- text, không phải số
  personal_email  text,
  tax_code        text UNIQUE,
  social_insurance_no text UNIQUE,
  marital_status  text,
  version         integer NOT NULL DEFAULT 1,  -- optimistic locking
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employee_code (
  code        text PRIMARY KEY,                -- giữ nguyên mã cũ, kể cả số 0 đầu
  person_id   uuid NOT NULL REFERENCES person(id),
  source      text NOT NULL CHECK (source IN ('legacy','system')),
  is_primary  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_primary_code ON employee_code(person_id) WHERE is_primary;

CREATE TABLE identity_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id),
  doc_type  text NOT NULL,             -- 'CCCD' (CMND: chờ D-08)
  number    text NOT NULL,
  issued_on date, issued_place text,
  UNIQUE (doc_type, number)
);

CREATE TABLE employment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES person(id),
  start_date date NOT NULL,
  end_date   date CHECK (end_date IS NULL OR end_date >= start_date),
  work_email text,
  version integer NOT NULL DEFAULT 1,
  EXCLUDE USING gist (person_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);
CREATE UNIQUE INDEX work_email_active ON employment(lower(work_email)) WHERE end_date IS NULL;

CREATE TABLE job_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_id  uuid NOT NULL REFERENCES employment(id),
  effective_from date NOT NULL,
  effective_to   date,                          -- loại trừ; NULL = đang hiệu lực
  department_id  uuid NOT NULL, position_id uuid NOT NULL, job_level_id uuid,
  manager_employment_id uuid REFERENCES employment(id),
  change_reason  text NOT NULL,
  EXCLUDE USING gist (employment_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&),
  CHECK (manager_employment_id IS DISTINCT FROM employment_id)
);

CREATE TABLE audit_event (
  id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL, action text NOT NULL,      -- create/update/correct/change_assignment/export/...
  entity text NOT NULL, entity_id uuid NOT NULL, reason text,
  source text NOT NULL, import_batch_id uuid                -- 'form' | 'import' | 'export'
);
CREATE TABLE audit_field_change (
  audit_event_id bigint REFERENCES audit_event(id), field text, old_value text, new_value text
);  -- trường nhạy cảm: lưu old/new đã mã hoá hoặc che (D-10)
-- Quyền DB của ứng dụng: chỉ INSERT/SELECT trên bảng audit, không UPDATE/DELETE.

CREATE TABLE import_batch (
  id uuid PRIMARY KEY, mode text CHECK (mode IN ('create','update')),
  layout text NOT NULL, file_sha256 text NOT NULL, uploaded_by uuid NOT NULL,
  status text NOT NULL,  -- validated / confirmed / committed / expired
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE TABLE import_row (
  batch_id uuid REFERENCES import_batch(id), row_no int,
  normalized jsonb,      -- chỉ chứa trường trong phạm vi, đã chuẩn hoá; KHÔNG có lương/hợp đồng
  match_person_id uuid, match_version int,   -- phiên bản đã xem trước, dùng phát hiện xung đột
  outcome text,          -- new / update / no_change / blocked_duplicate / error / conflict
  messages jsonb, diff jsonb, commit_result text,
  PRIMARY KEY (batch_id, row_no)
);
-- Không lưu file gốc, chỉ lưu hash. Staging tự xoá sau N ngày (D-16).
```

---

## 3. Quy tắc kiểm tra dùng chung

Có **một module kiểm tra duy nhất ở máy chủ**, gồm `normalize(field, raw)` và `validate(field, value, context)`. Form, nhập Excel và API đều gọi module này. Client chỉ dùng bản sinh ra từ cùng schema (ví dụ JSON Schema/Zod) để báo lỗi sớm, còn máy chủ luôn kiểm tra lại.

| Mã | Quy tắc | Mức |
|---|---|---|
| V-TXT-ID | Cột `text-id` mà ô Excel ở dạng số, công thức hoặc số mũ (`1.2E+11`) thì báo lỗi: "Định dạng ô phải là Text". Không đệm số 0. | Lỗi |
| V-DATE | Chấp nhận ô ngày Excel (hệ 1900 và 1904, không lệch múi giờ) hoặc chuỗi `dd/mm/yyyy`. Từ chối `d/m/yy`, `mm/dd/yyyy` và ngày không tồn tại như 31/02. **v0.2 (R08):** ngày vào trước 2000 hoặc sau hôm nay + 90 ngày chỉ *cảnh báo* (đã triển khai ở form/API). | Lỗi / Cảnh báo |
| V-REQ | Bắt buộc: B, C, J, N, O khi nhập mới. Bắt buộc: B khi cập nhật. | Lỗi |
| V-REF | Giá trị danh mục phải khớp chính xác (sau khi cắt khoảng trắng và so không phân biệt hoa/thường). Không tự tạo mục mới. | Lỗi |
| V-UNIQ-FILE | B, AI, AO, AP xuất hiện từ hai lần trở lên trong cùng file thì **tất cả** các dòng liên quan đều lỗi. | Lỗi |
| V-UNIQ-SYS | Nhập mới mà B, AI, AO hoặc AP đã tồn tại trong hệ thống thì chặn dòng (`blocked_duplicate`). | Chặn |
| V-SOFT-DUP | Họ tên kèm DOB, email cá nhân hoặc email công ty trùng với người khác thì **chỉ cảnh báo**, không bao giờ tự gộp. | Cảnh báo |
| V-CROSS | J ≤ K, DOB < AJ, tuổi tại J ≥ ngưỡng, O phải khớp P, R không trỏ tới chính mình | Lỗi |
| V-OUT | Cột NPV có dữ liệu thì báo một cảnh báo chung cho file, ví dụ "các cột U–X, BF–CD có dữ liệu và sẽ bị bỏ qua". Không hiển thị giá trị của các cột đó. | Cảnh báo |
| V-UNMAPPED | Cột CXN có dữ liệu thì cảnh báo "chưa nhập vì chờ xác nhận nghiệp vụ" | Cảnh báo |
| V-FILE | Chỉ nhận `.xlsx`, tối đa 5 MB và 2.000 dòng, đúng 1 sheet. Từ chối `.xlsm`/`.xls`. Fingerprint phải khớp. | Từ chối file |

**Nhận diện người (không bao giờ dựa vào tên hoặc email):**

| Chế độ | Khoá khớp | Kết quả |
|---|---|---|
| Nhập mới | Kiểm tra B, AI, AO, AP với hệ thống | Không khớp khoá nào thì `new`. Khớp bất kỳ khoá nào thì `blocked_duplicate`, không tạo người. Nhờ vậy nhập lại file sẽ không tạo trùng. |
| Cập nhật | **Chỉ B (mã NV)**, khớp đúng một người | Không tìm thấy thì `error`; chế độ cập nhật không bao giờ tạo người mới. Nếu AI/AO/AP trong file có giá trị và khác giá trị đang lưu thì `conflict`, không ghi, chuyển xử lý thủ công. Tên khác thì cảnh báo và hiện rõ ở phần so sánh. |

**v0.2 (R08), áp dụng cho form và API đã triển khai:**
- Họ tên được chuẩn hoá NFC và gộp khoảng trắng, dài 2–150 ký tự. Có chữ số thì *cảnh báo* `NAME_CONTAINS_DIGIT`, không sửa tên.
- Điện thoại chỉ bỏ ký tự phân cách, không tự thêm số 0 hay đổi đầu +84.
- Email công ty phải thuộc miền công ty.
- Ngày sinh không được ở tương lai. Dưới khoảng 15 tuổi thì cảnh báo `AGE_REVIEW`; đây không phải kết luận pháp lý.
- Kiểm tra trùng bỏ qua giá trị rỗng.
- Định danh trước đó trống nay được bổ sung giá trị hợp lệ thì cho ghi theo quyền. Chỉ khi đổi một giá trị đã có mới cần luồng đính chính.

**Ô trống khi cập nhật** nghĩa là **không thay đổi**. Excel không có cách xoá giá trị; muốn xoá phải dùng form và nhập lý do (D-02).

**Cập nhật phân công qua Excel:** nếu N/O/Q/R khác phân công hiện tại thì dòng được đánh dấu `conflict`, ghi chú "Thay đổi phân công cần ngày hiệu lực, hãy dùng form", và **không ghi**. Lý do: template không có cột ngày hiệu lực (D-07b).

---

## 4. Luồng màn hình

### 4.1 Hồ sơ
1. **Danh sách nhân sự**: tìm theo mã NV hoặc tên, lọc theo phòng ban, trạng thái giai đoạn và quản lý. Các cột hiển thị do máy chủ trả về theo quyền.
2. **Chi tiết hồ sơ** gồm các tab: Cá nhân · Giấy tờ · Liên hệ & khẩn cấp · Học vấn · **Giai đoạn & phân công** (dòng thời gian) · **Lịch sử thay đổi** (từ audit). Trường nhạy cảm được che mặc định, bấm "Hiện" mới xem và hành động này được ghi audit.
3. **Thêm mới** (3 bước):
   - Bước 1, Định danh: nhập mã NV và CCCD, máy chủ kiểm tra trùng. Nếu trùng thì dừng và hiện liên kết tới hồ sơ hiện có (chỉ khi người dùng có quyền xem).
   - Bước 2, Thông tin: thông tin cá nhân, giai đoạn làm việc (ngày vào, email công ty) và phân công ban đầu (hiệu lực từ ngày vào).
   - Bước 3, **Xem lại**: hiện toàn bộ giá trị sẽ ghi, bấm "Xác nhận lưu". Person, mã NV, giấy tờ, employment và assignment được ghi trong **một transaction**.
4. **Sửa thông tin cá nhân**: form chỉ hiện những trường người dùng được sửa. Trước khi lưu có hộp thoại so sánh trước/sau, lý do là bắt buộc với trường nhạy cảm. Nếu `version` lệch thì báo "Hồ sơ đã bị người khác sửa" và tải lại.
5. **Thay đổi phân công** (thay đổi thực tế): chọn ngày hiệu lực và lý do, xem lại dòng thời gian sau thay đổi rồi xác nhận.
6. **Đính chính phân công** (nhập sai): sửa đúng một dòng phân công, bắt buộc nhập lý do.
7. **Kết thúc giai đoạn** / **Tái tuyển**: tái tuyển tạo giai đoạn mới, mã NV dùng lại hay cấp mới tuỳ D-03.

### 4.2 Nhập Excel
```
[Chọn chế độ: Nhập mới | Cập nhật]  (hai nút, hai quyền riêng)
  → [Tải file] → máy chủ: kiểm tra file, fingerprint → đọc → bỏ cột NPV → chuẩn hoá → kiểm tra → khớp người
  → [Xem trước]  bộ lọc: Mới · Cập nhật · Không đổi · Trùng/Chặn · Xung đột · Lỗi
       • Mỗi dòng: mã NV, họ tên, kết quả, thông báo
       • Dòng cập nhật: bảng trường | giá trị hiện tại | giá trị mới (chỉ trường thay đổi)
       • Tải "file lỗi" (file gốc thêm cột Lỗi; đã bỏ cột NPV)
  → [Xác nhận ghi N dòng hợp lệ] (lỗi/chặn/xung đột không ghi được)
  → máy chủ ghi TỪNG DÒNG trong transaction riêng; kiểm tra lại version trước khi ghi
  → [Kết quả]: đã ghi / thất bại khi ghi (rollback dòng đó) / bỏ qua; có liên kết tới audit
```
Trước khi bấm Xác nhận, **chưa có gì được ghi** vào bảng nghiệp vụ, chỉ staging. Batch hết hạn sau N giờ thì phải tải lại file.

### 4.3 Xuất Excel
Chọn phạm vi (bộ lọc của danh sách) và chọn cột. **Máy chủ chỉ cho chọn những cột thuộc nhóm trường người dùng được xuất**; yêu cầu chứa cột ngoài quyền bị trả 403, không âm thầm bỏ cột. File xuất:
- dùng bố cục `export-v1` (không chứa cột NPV);
- định dạng các cột `text-id` là Text (`@`) để nhập lại không mất số 0;
- thêm `'` trước ô bắt đầu bằng `= + - @` (chống chèn công thức);
- mỗi lần xuất ghi audit (người xuất, bộ lọc, danh sách cột, số dòng).

### 4.4 Quyền (bản v0.1; v0.2 thay bằng ma trận trong ADR-0003 cho S0–S3)

| Nhóm trường | Ví dụ | NV (của mình) | Quản lý (cấp dưới) | HR | HR Admin |
|---|---|---|---|---|---|
| Danh bạ | tên, email công ty, phòng ban, chức danh, quản lý | Xem | Xem | Xem/Sửa/Xuất | Xem/Sửa/Xuất |
| Cá nhân cơ bản | giới tính, DOB, SĐT, email cá nhân, học vấn, liên hệ khẩn cấp | Xem | — | Xem/Sửa/Xuất | Xem/Sửa/Xuất |
| Nhạy cảm | CCCD, MST, BHXH, (ngân hàng, địa chỉ: chờ CXN) | Xem (che) | — | Xem/Sửa | Xem/Sửa/Xuất |
| Nhập Excel | — | — | — | Cập nhật | Nhập mới + Cập nhật |

Mọi endpoint (đọc, sửa, xuất, nhập) đều kiểm tra `(user, action, field_group, target_person)` ở máy chủ. API chỉ trả về các trường người dùng được xem, không chỉ ẩn ở giao diện.

---

## 5. Các quyết định còn thiếu

**v0.2: quyết định phát triển** (đề xuất của PO/TA để làm local; *không* xác nhận ý nghĩa dữ liệu lịch sử):

| Mã | Quyết định phát triển | Còn cần trước khi nhập dữ liệu thật |
|---|---|---|
| D-01 | ADR-0001 (Next.js 16, PostgreSQL 18, Prisma 7). Chạy local, chưa chọn hosting | Hosting, Entra app registration |
| D-02 | Excel v1 không xoá giá trị; xoá qua form có quyền và lý do (S4) | — |
| D-03 | ADR-0002: giữ mã cũ, không tái sử dụng, tự cấp `ES` + ≥4 chữ số (đã triển khai) | Danh sách mã cũ, cách xử lý mã khác hoa/thường |
| D-04 | Trạng thái làm việc tính từ Employment/event (đã triển khai: chưa có giai đoạn, chưa bắt đầu, đang làm, đã nghỉ) | Ý nghĩa L/S/T |
| D-05 | Mẫu chuẩn dùng ngày đầy đủ | Ý nghĩa G–I, AA–AC |
| D-06 | `start_date` là ngày bắt đầu giai đoạn; `end_date` là ngày cuối, bao gồm ngày đó | J/K thực sự nghĩa là gì |
| D-07 | Quản lý chọn theo person_id, xét tại ngày hiệu lực (đã triển khai); đổi phân công qua form (S4) | Cột R nguồn ghi gì |
| D-08 | Giấy tờ là bản ghi có loại; chưa bật (API từ chối) | Loại giấy tờ, định dạng |
| D-09 | Ngân hàng chưa làm (API từ chối) | Nhu cầu, rà soát pháp lý PL-03 |
| D-10 | ADR-0003 | Người thật được cấp vai trò; xác nhận HR_VIEWER |
| D-11 | Quản trị danh mục (đã triển khai); seed danh mục giả | Danh mục thật, cặp tên EN/VI |
| D-12 | Link, CV, checklist giấy tờ: NPV | — |
| D-13 | Người phụ thuộc, con: chưa làm. Ghi chú HR, liên hệ khẩn cấp: S4 | Ý nghĩa M, BC; rà soát PL-03 (dữ liệu trẻ em). **Căn cứ cập nhật:** Luật 91/2025/QH15 và NĐ 356/2025/NĐ-CP thay NĐ 13/2023 từ 01/01/2026 |
| D-14 | Địa chỉ thường trú/liên hệ hiện hành có lịch sử (S4) | Quan hệ AS–AV |
| D-15 | Hoãn đồng bộ; đã có bảng `external_identity` | API, khoá liên kết |
| D-16 | ADR-0004: staging 72 giờ và idempotency 24 giờ là lựa chọn sản phẩm | **Lịch lưu giữ có căn cứ pháp luật (PL-01)** |

Bảng câu hỏi gốc của v0.1:

| Mã | Câu hỏi | Người quyết | Ảnh hưởng nếu chưa có |
|---|---|---|---|
| D-01 | Stack (ngôn ngữ, framework, DB), cơ chế đăng nhập (SSO?), hạ tầng | TA | Chưa bắt đầu S0 được |
| D-02 | Có cho xoá giá trị qua Excel không (ví dụ bằng token `[XÓA]`)? | PO | Mặc định: không |
| D-03 | Định dạng mã NV; mã có bao giờ được tái sử dụng cho người khác không; tái tuyển giữ mã cũ hay cấp mới; quy tắc sinh mã mới | PO | Mặc định: mã duy nhất vĩnh viễn, nhập thủ công |
| D-04 | Ý nghĩa và mối quan hệ của **L STATUS, S CLASSIFY, T STATUS**; có suy ra từ K hay không | PO | Không nhập ba cột này |
| D-05 | Ý nghĩa của **G–I** và **AA–AC** (Date/Month/Year) | PO | Không nhập |
| D-06 | Ngày vào tính từ thử việc hay chính thức; ngày nghỉ là ngày làm việc cuối hay ngày chấm dứt | PO | Mặc định: lưu đúng giá trị nguồn, gắn nhãn "theo file" |
| D-07 | Cột R ghi tên hay mã. (b) Có thêm cột "Ngày hiệu lực" vào template nhập để đổi phân công không | PO | Ghi tên thì báo lỗi; thay đổi phân công chỉ làm qua form |
| D-08 | Có chấp nhận CMND 9 số/hộ chiếu (người nước ngoài) không | PO | Chỉ nhận CCCD 12 số |
| D-09 | Tài khoản ngân hàng thuộc giai đoạn này hay payroll | PO | Không nhập |
| D-10 | Danh sách vai trò, ma trận quyền, trường nào bị che trong audit/export | PO + Bảo mật | Dùng bảng 4.4 làm bản nháp |
| D-11 | Danh mục: phòng ban, chức danh (EN/VI), cấp bậc, giới tính, tình trạng hôn nhân, trình độ, ngân hàng, tên miền email công ty | PO/HR | Chưa kiểm tra `ref` được |
| D-12 | D, E, F, CH–CK: lưu liên kết, tài liệu hay checklist? | PO | Mặc định NPV |
| D-13 | M (NOTE), AX, AY–BB (con), BC | PO + Pháp chế (dữ liệu trẻ em, NĐ 13/2023) | Không nhập |
| D-14 | Bốn cột địa chỉ AS–AV: quan hệ cũ/mới, cột nào là hiện hành, có cần giữ cả hai không | PO | Không nhập |
| D-15 | Leave tool dùng khoá nào để liên kết nhân viên (mã NV, email công ty hay ID riêng); hướng đồng bộ | TA | Chưa thiết kế tích hợp |
| D-16 | Thời gian giữ staging và audit; mã hoá trường nhạy cảm khi lưu | TA + Bảo mật | Mặc định: staging 72 giờ, mã hoá cột nhạy cảm |

---

## 6. Các phần triển khai nhỏ

**v0.2: trạng thái.**
- S0 (nền tảng, xác thực, quyền, OpenAPI): **đã làm ở local**.
- S1 (lược đồ, ràng buộc): **đã làm** cho Person, mã NV, Employment, Assignment, audit, idempotency. Chưa làm giấy tờ và staging.
- S2 (chuẩn hoá và kiểm tra): **một phần**. Đã có cho các trường của form; bộ đọc Excel chưa có.
- S3 (tạo hồ sơ): **đã làm**. Form dùng một bước kèm thông báo lỗi; chưa có bước "xem lại" riêng vì tạo mới chưa ghi đè dữ liệu nào.
- S4 trở đi: chưa làm.

| # | Phần | Tiêu chí nghiệm thu | Bằng chứng kiểm thử |
|---|---|---|---|
| S0 | Khung dự án, xác thực, phân quyền nền (sau D-01, D-10) | Mọi endpoint mặc định từ chối; có middleware kiểm tra quyền theo field_group | Test API: thiếu quyền trả 403 cho từng endpoint |
| S1 | Lược đồ person / employee_code / employment / job_assignment / audit + migration | Ràng buộc DB chặn mã trùng, CCCD trùng, giai đoạn chồng lấn, phân công chồng lấn; audit không UPDATE/DELETE được | Test tích hợp với DB thật (container); kiểm tra grant của bảng audit |
| S2 | Module chuẩn hoá và kiểm tra dùng chung | Toàn bộ quy tắc V-* có test; `text-id` không bao giờ đi qua kiểu số | Unit test và property test: ∀ chuỗi số có số 0 đầu, `normalize` → lưu → xuất → đọc lại cho ra đúng chuỗi ban đầu |
| S3 | Thêm mới qua form (3 bước) | Không ghi trước khi xác nhận; trùng định danh thì dừng ở bước 1; ghi trong 1 transaction | Test E2E; test lỗi giữa chừng không để lại bản ghi dở |
| S4 | Sửa hồ sơ, thay đổi/đính chính phân công, xem lịch sử | Mỗi lần sửa sinh audit với giá trị trước/sau; thay đổi phân công đóng dòng cũ đúng ngày; version lệch trả 409 | Test API và test truy vấn dòng thời gian |
| S5 | Đọc file, fingerprint, staging, xem trước chế độ **nhập mới** | Sai bố cục thì từ chối; cột NPV không có trong staging/log; chưa ghi bảng nghiệp vụ | Test với file tổng hợp; quét staging và log không tìm thấy giá trị lương mẫu |
| S6 | Xem trước chế độ **cập nhật** và bảng so sánh | Khớp chỉ theo mã NV; ô trống không đổi; xung đột định danh và phân công bị chặn | Bộ GWT ở mục 7 |
| S7 | Ghi từng dòng có transaction, báo cáo kết quả, file lỗi | Dòng lỗi không để lại gì; nhập lại cùng file không tạo người mới; version lệch tại lúc ghi thì dòng thành `conflict` | Test chèn lỗi (fault injection) ở giữa transaction của một dòng |
| S8 | Xuất Excel theo quyền | Yêu cầu cột ngoài quyền trả 403; cột text-id ở định dạng Text; chống chèn công thức; có audit | Test API theo từng vai trò; mở file xuất kiểm tra kiểu ô |
| S9 | (Sau D-15) Đồng bộ với leave tool | — | — |

---

## 7. Bộ kiểm thử Given–When–Then

> **Dữ liệu kiểm thử chỉ là dữ liệu tổng hợp.** Tên dạng `Nhân Viên Thử A` (v0.2/R08: không dùng chữ số trong tên fixture), email `@example.test`, CCCD/MST/BHXH sinh ngẫu nhiên có tiền tố `999`, ngân hàng giả. Có kiểm tra tự động: CI fail nếu fixture chứa email không thuộc `example.test`.

**Nhận diện, chống trùng**
1. **Given** hệ thống có người mã `00123`, CCCD `999000000001` **When** nhập mới một dòng mã `00123`, tên khác **Then** dòng ở trạng thái `blocked_duplicate`, không có person mới.
2. **Given** có người mã `00123` **When** nhập mới một dòng mã `00999` nhưng CCCD `999000000001` **Then** dòng bị chặn vì trùng CCCD.
3. **Given** có người tên `Nhân Viên Thử A`, email cá nhân `a@example.test` **When** nhập mới một dòng mã mới, CCCD mới, cùng tên và cùng email **Then** dòng `new` kèm cảnh báo trùng mềm, không gộp với người cũ.
4. **Given** file 10 dòng đã nhập mới thành công **When** tải lại đúng file đó ở chế độ nhập mới **Then** 10/10 dòng `blocked_duplicate`, tổng số person không đổi.
5. **Given** file có hai dòng cùng mã `00555` **When** xem trước **Then** cả hai dòng lỗi V-UNIQ-FILE.
6. **Given** chế độ cập nhật **When** dòng có mã `07777` không tồn tại **Then** dòng `error`, không tạo person.
7. **Given** chế độ cập nhật, người `00123` có CCCD `999000000001` **When** dòng `00123` có CCCD `999000000002` **Then** dòng `conflict`, không ghi trường nào của dòng.
8. **Given** chế độ cập nhật **When** dòng chỉ có email công ty khớp một người, mã NV để trống **Then** dòng lỗi V-REQ, không khớp theo email.

**Số 0 đầu và định dạng**
9. **Given** ô B là Text `00123` **When** nhập **Then** lưu mã đúng `00123`.
10. **Given** ô AF là số `912345678` (Excel đã mất số 0) **When** xem trước **Then** lỗi V-TXT-ID "Định dạng ô phải là Text", không tự thêm số 0.
11. **Given** ô AI là số hiển thị `1.23457E+11` **When** xem trước **Then** lỗi V-TXT-ID.
12. **Given** người có SĐT `0912345678`, BHXH `0123456789` **When** xuất rồi nhập lại file đó ở chế độ cập nhật **Then** mọi dòng `no_change`.
13. **Given** ô J là chuỗi `31/02/2024` **When** xem trước **Then** lỗi V-DATE.

**Xác nhận trước khi ghi, ghi nguyên vẹn**
14. **Given** file cập nhật hợp lệ đã xem trước **When** người dùng chưa bấm Xác nhận **Then** các bảng person, employment và audit không thay đổi.
15. **Given** dòng cập nhật đổi SĐT **When** xem trước **Then** bảng so sánh hiện `SĐT | 0912345678 | 0987654321` và chỉ hiện trường thay đổi.
16. **Given** batch có 5 dòng hợp lệ, dòng thứ 3 gặp lỗi DB giả lập khi ghi giấy tờ **When** xác nhận **Then** dòng 3 không để lại person/employment/identity nào, 4 dòng còn lại được ghi, báo cáo ghi rõ dòng 3 thất bại.
17. **Given** batch đã xem trước với person `00123` version 4 **When** người khác sửa `00123` (thành version 5) rồi batch được xác nhận **Then** dòng `00123` chuyển `conflict`, không ghi đè.
18. **Given** batch đã hết hạn **When** bấm Xác nhận **Then** máy chủ từ chối và yêu cầu tải lại file.

**Ô trống, lịch sử**
19. **Given** người `00123` có email cá nhân `a@example.test` **When** cập nhật bằng dòng có ô AG trống **Then** email vẫn là `a@example.test`, không có audit cho trường này.
20. **Given** người đang ở phòng `DEV` từ 01/01/2025 **When** thay đổi phân công sang `QA` hiệu lực 01/07/2026 **Then** dòng cũ có `effective_to = 01/07/2026`, dòng mới bắt đầu từ 01/07/2026, lịch sử còn đủ cả hai.
21. **Given** cập nhật Excel có cột N khác phòng ban hiện tại **When** xem trước **Then** dòng `conflict` "cần ngày hiệu lực", không đổi phân công.
22. **Given** người đã nghỉ (giai đoạn 2020–2023) **When** tái tuyển từ 2026 **Then** có 2 employment, giai đoạn cũ không bị sửa.
23. **Given** mọi thao tác ghi ở trên **When** truy vấn audit **Then** mỗi thay đổi có người thực hiện, thời điểm, nguồn và *tên* trường (v0.2: không lưu giá trị trước/sau trong audit, xem ADR-0004); lệnh UPDATE/DELETE vào audit bằng tài khoản ứng dụng bị DB từ chối.

**Phạm vi dữ liệu**
24. **Given** file có giá trị ở BF (lương) và U–X, BG–CD (hợp đồng) **When** nhập **Then** chỉ có một cảnh báo V-OUT; quét staging, log ứng dụng và DB không thấy các giá trị mẫu này; file gốc không được lưu.
25. **Given** file có giá trị ở L, S, T, G–I, AA–AC, AS–AV **When** nhập **Then** cảnh báo V-UNMAPPED, các giá trị này không được ghi vào trường nào.
26. **Given** file có tiêu đề cột AI bị đổi thành "CMND" **When** tải lên **Then** từ chối cả file vì sai fingerprint, không đọc dòng nào.

**Quyền ở máy chủ**
27. **Given** vai trò Quản lý **When** gọi API chi tiết của người không phải cấp dưới **Then** 403.
28. **Given** vai trò HR (không có quyền xuất nhóm nhạy cảm) **When** gọi API xuất với cột `tax_code` **Then** 403, không sinh file; có audit lần bị từ chối.
29. **Given** vai trò Quản lý **When** gọi API chi tiết cấp dưới **Then** JSON trả về không có khoá `tax_code`, `social_insurance_no`, `identity_document` (không phải trả `null` rồi để giao diện ẩn).
30. **Given** vai trò HR (chỉ có quyền cập nhật) **When** gọi trực tiếp API xác nhận batch chế độ nhập mới **Then** 403.
31. **Given** chuỗi tổng hợp `=HYPERLINK("http://x.test")` hoặc `+84900000000` **When** bộ xuất ghi ô **Then** ô là kiểu chuỗi, không có công thức; đọc lại ra đúng chuỗi ban đầu (v0.2/R09: không thêm `'`).

**v0.2: GWT cho S0–S3.** Tất cả đã có test tự động trong `tests/`. Kết quả chạy ghi trong báo cáo bàn giao.

32. **Given** HR_EDITOR **When** tạo hồ sơ `draft` chỉ có họ tên **Then** 201, mã `ES####` tự cấp, không có Employment hay Assignment, có đúng 1 audit chỉ ghi tên trường.
33. **Given** `profile_state=complete` thiếu mục checklist **When** tạo **Then** 422 `CHECKLIST_INCOMPLETE` liệt kê mục thiếu, không ghi gì.
34. **Given** ngày bắt đầu ở tương lai **When** tạo đủ dữ liệu **Then** trạng thái `not_started`.
35. **Given** email công ty đang được cấp cho người khác (kể cả người có ngày nghỉ trong tương lai) **When** tạo **Then** 409 `WORK_EMAIL_IN_USE`, không còn Person, mã hay audit nào (rollback).
36. **Given** 10 yêu cầu tạo đồng thời **Then** 10 mã khác nhau. **Given** 5 yêu cầu đồng thời cùng Idempotency-Key **Then** 1 hồ sơ và 1 audit.
37. **Given** gửi lại cùng key và payload **Then** cùng hồ sơ, `Idempotent-Replayed: true`. Cùng key khác payload **Then** 409. Bị thu hồi quyền rồi gửi lại **Then** 403.
38. **Given** trường CCCD, MST, ngân hàng hoặc người phụ thuộc trong body **Then** 422 `PROTECTED_FIELD_NOT_ENABLED`. Trường lạ **Then** 400 `FIELD_NOT_ALLOWED`.
39. **Given** HR_VIEWER **When** xem chi tiết **Then** JSON không có khoá `personal`, các mục checklist cá nhân là `null`.
40. **Given** thiếu token, hoặc token sai audience, tenant, issuer, hết hạn hay thiếu scope **Then** 401. Đã có token nhưng thiếu quyền **Then** 403. `/api/v1/internal/openapi.json` **Then** 401/403/200 theo `docs.read`.
41. **Given** `NODE_ENV=production` hoặc `APP_ENV=production` **Then** token test bị 401 và `/api/v1/dev/*` trả 404 (kiểm tra cả trên bản `next build && next start`).
42. **Given** role DB `hrms_app` **Then** không UPDATE/DELETE được audit, không xoá được person, không sửa được sổ mã, không DDL; giai đoạn hoặc phân công chồng lấn và phân công ngoài giai đoạn bị DB chặn.

---

## 8. Thiết kế Excel cho đợt S5–S8 (chưa triển khai)

**Định dạng (R01).**
- `core-hr-v1`:
  - Hàng tiêu đề là mã trường duy nhất (ví dụ `employee_code`, `full_name`, `mobile_phone`), cho phép đổi thứ tự cột.
  - Có sheet `_meta` ghi phiên bản mẫu.
  - Cột trùng hoặc mơ hồ thì chặn cả file.
  - Các cột siêu dữ liệu `_source_row`, `_error_code`, `_error_message` được importer bỏ qua.
  - Chế độ cập nhật chỉ cần `employee_code` và các cột muốn đổi; cột vắng mặt hoặc ô trống đều không đổi.
- `legacy-v0`:
  - Kiểm toạ độ và tiêu đề theo bảng §1.
  - Lệch thì hiển thị khác biệt và đề nghị chuyển sang mẫu chuẩn; không tự ghép cột.
  - Cột CXN (L/S/T, G–I, AA–AC, AS–AV, M, BC...) không được ánh xạ.

**Đọc ô.**
- Kiểm tra kiểu giá trị thật: ô kiểu chuỗi `00123` giữ nguyên; ô kiểu số ở cột định danh thì báo lỗi.
- Chỉ xét ô có nội dung; bỏ qua vùng chỉ có style.
- Giới hạn file 5 MB, 2.000 dòng; giới hạn thêm kích thước sau giải nén và số ô.

**Staging (R07).**
- `import_batch` gắn người tạo và phạm vi quyền; người khác không đọc hay xác nhận được batch.
- `import_row` chỉ chứa trường trong phạm vi, có mã hoá.
- Payload được xoá sau khi hoàn tất hoặc khi quá 72 giờ.
- Không lưu file gốc. Phải kiểm tra cả thư mục tạm, request log và error telemetry.

**Xem trước → xác nhận (R05, R06, R10).**
- Khi xác nhận, kiểm tra lại quyền và `person.revision` đã xem trước.
- Mỗi dòng nằm trong một transaction gồm thay đổi nghiệp vụ, audit và dấu kết quả dòng.
- Gửi lại batch đã commit thì trả kết quả cũ; batch chạy dở thì tiếp tục các dòng chưa commit.
- Quản lý được resolve từ staging + DB và ghi theo thứ tự phụ thuộc. Quản lý thất bại thì nhân viên phụ thuộc ở trạng thái chờ.

**Snapshot (R03).** Batch chuyển đổi bắt buộc có `snapshot_date` do HR xác nhận. Phân công ghi từ ngày đó với `record_source = snapshot_import`. Hồ sơ đã nghỉ mà không có mốc hợp lệ thì giữ ngoài dữ liệu đã xác minh.

**Xuất (R09).** Ghi ô kiểu chuỗi, cột định danh định dạng Text, không có công thức. "Tải file để cập nhật" (`core-hr-v1`, có mã) khác với "Báo cáo tự chọn cột". Không xuất cột ngoài quyền, kể cả trong file lỗi.

## 9. Endpoint dự kiến (chưa có trong OpenAPI dùng thử)

- S4:
  - `PATCH /api/v1/core-hr/employees/{id}` (`expected_revision`, null chỉ xoá khi được phép);
  - `GET`/`POST …/employees/{id}/employments`;
  - `POST …/employments/{id}/events`;
  - `GET`/`POST …/employments/{id}/assignments`;
  - `GET …/audit-logs`.
- Excel:
  - `GET …/import-templates/employees`;
  - `POST …/imports/employees`;
  - `GET …/imports/{id}` và `…/imports/{id}/rows`;
  - `POST …/imports/{id}/confirm`;
  - `GET …/imports/{id}/errors.xlsx`;
  - `POST …/exports/employees`.
