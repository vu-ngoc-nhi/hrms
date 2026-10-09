# Rà soát pháp lý — Core HR S0–S3 (dữ liệu cá nhân người lao động)

> **Tính chất:** AI tự rà soát theo góc nhìn pháp lý Việt Nam để nhận diện rủi ro thiết kế. **Không phải ý kiến luật sư**, chưa được luật sư hoặc chuyên gia độc lập phê duyệt. Không khẳng định hệ thống "tuân thủ" hay "không vi phạm".
> **Ngày kiểm tra nguồn:** 07/10/2026.
> **Phạm vi:** dữ liệu được triển khai ở S0–S3 trên môi trường local, chỉ dùng dữ liệu tổng hợp. Chưa đánh giá hosting, nhà cung cấp, sao lưu hay vận hành thật.

## 1. Nguồn đã kiểm tra và giới hạn

Trong phiên làm việc này, một lượt tra cứu đã tải văn bản từ cổng chính thức của Chính phủ. Các bản PDF có chữ ký số là bản scan, nên được đọc bằng OCR rồi tóm tắt. Mình không đọc lại toàn văn từng điều. Các điều khoản dưới đây vẫn cần luật sư đối chiếu trước khi dùng làm căn cứ chính thức.

| Văn bản | Trạng thái ghi nhận | Nguồn |
|---|---|---|
| Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 | Hiệu lực từ 01/01/2026; cổng văn bản Chính phủ ghi còn hiệu lực | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?pageid=27160&docid=214590&classid=1&typegroupid=3), [PDF](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/7/91qh.signed.pdf) |
| Nghị định 356/2025/NĐ-CP | Hiệu lực từ 01/01/2026 (Điều 42) | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?docid=216387&pageid=27160) |
| Nghị định 13/2023/NĐ-CP | Hết hiệu lực từ 01/01/2026 (Điều 42.2 NĐ 356). Sự đồng ý đã thu theo NĐ 13 được dùng tiếp (Điều 39 Luật 91) | như trên |
| Bộ luật Lao động 2019, Điều 12 (sổ quản lý lao động) | Còn hiệu lực. Luật sửa đổi BLLĐ đang ở dạng dự thảo | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?pageid=27160&docid=198540) |
| Nghị định 145/2020/NĐ-CP, Điều 3 | Còn hiệu lực. Có dự thảo sửa (7/2026), chưa ban hành | [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?pageid=27160&docid=201967) |

**Chưa xác minh:**
- thời hạn lưu trữ tối thiểu cụ thể cho hồ sơ nhân sự hoặc sổ quản lý lao động của doanh nghiệp tư nhân;
- tiêu chí doanh nghiệp nhỏ/vừa áp dụng cho công ty;
- nghị định xử phạt về bảo vệ dữ liệu cá nhân năm 2026;
- việc xếp mã số thuế, số BHXH, email và số tài khoản ngân hàng vào nhóm "cơ bản": các văn bản không nêu tên những trường này, nên đây chỉ là suy luận từ câu chữ.

## 2. Bảng nhóm dữ liệu đã triển khai (S0–S3)

"Phân loại pháp luật" theo Điều 3–4 NĐ 356, tách riêng khỏi "Mức bảo mật nội bộ", vì nội bộ có thể đặt mức chặt hơn luật. Cột "Bắt buộc?" nói về checklist của sản phẩm, **không** phải nghĩa vụ pháp luật. Trường có trong file Excel cũ không có nghĩa là phải thu thập.

| Nhóm / trường | Mục đích | Mức cần thiết | Phân loại pháp luật (NĐ 356) | Mức nội bộ | Căn cứ xử lý cần xác minh | Ai xem / xuất | Lưu / xoá | Người chốt |
|---|---|---|---|---|---|---|---|---|
| Họ tên, mã NV | Nhận diện hồ sơ, quản lý lao động | Cần | Cơ bản (Đ3) | Danh bạ | Thực hiện HĐLĐ / nghĩa vụ sổ quản lý lao động (Đ19.1.d Luật 91, Đ12 BLLĐ). Cần luật sư xác nhận cách áp dụng | HR_ADMIN, HR_EDITOR, HR_VIEWER. Chưa có xuất | Mã giữ vĩnh viễn trong registry để không tái sử dụng. Họ tên: **chưa chốt** | PO + luật sư |
| Ngày sinh, giới tính | Quản lý lao động (thuộc nội dung sổ, Đ3 NĐ 145) | Checklist dev yêu cầu | Cơ bản | Cá nhân | Như trên | HR_ADMIN, HR_EDITOR | **Chưa chốt** | PO + luật sư |
| Điện thoại, email cá nhân | Liên lạc | Một trong hai (checklist dev) | Cơ bản (điện thoại nêu rõ; email suy luận) | Cá nhân | Thực hiện HĐLĐ hoặc đồng ý. **Cần xác minh** | HR_ADMIN, HR_EDITOR | **Chưa chốt** | PO + luật sư |
| Giai đoạn làm việc, email công ty | Quản lý lao động (ngày bắt đầu, chấm dứt) | Cần khi có quan hệ làm việc | Cơ bản | Danh bạ | Đ12 BLLĐ, Đ3 NĐ 145 | HR roles | Lịch sử nghiệp vụ. Thời hạn **chưa xác minh** | PO + luật sư |
| Phòng ban, chức danh, cấp bậc, quản lý | Tổ chức công việc | Checklist dev | Cơ bản (thông tin định danh khác) | Danh bạ | Thực hiện HĐLĐ | HR roles | Như trên | PO |
| Audit (người làm, tên trường) | Truy vết, an toàn hệ thống | Cần | Liên kết được tới người, **không** vô danh | Nội bộ kỹ thuật | Biện pháp bảo vệ (Đ30 Luật 91 yêu cầu bảo mật, xác thực, phân quyền) | Chưa có API đọc | **Chưa chốt** thời hạn | TA + luật sư |
| Tài khoản đăng nhập (tenant/oid) | Xác thực | Cần | Định danh điện tử: **cần xác minh** phân loại | Nội bộ kỹ thuật | Vận hành hệ thống | Không xuất | Theo vòng đời tài khoản: **chưa chốt** | TA |

**Không triển khai và API từ chối:**
- CCCD/CMND/hộ chiếu, MST, BHXH;
- tài khoản ngân hàng;
- người phụ thuộc, con;
- sức khoẻ, ảnh giấy tờ;
- lương, hợp đồng;
- địa chỉ (D-14 chưa rõ).

## 3. Rủi ro pháp lý

Mức độ dưới đây là ưu tiên thiết kế, không phải đánh giá mức xử phạt. Hiện trạng chỉ chạy local với dữ liệu tổng hợp, nên chưa có cơ sở cho rằng đã có vi phạm.

### PL-01 — RỦI RO PHÁP LÝ — CAO: lưu giữ vô hạn, hoặc xoá sạch ngay khi nghỉ việc

| Hạng mục | Nội dung |
|---|---|
| Căn cứ / độ chắc chắn | **Điều 25.2 Luật 91 (đã đối chiếu nguồn chính thức qua OCR):** dữ liệu người lao động được lưu theo thời hạn luật định hoặc theo thỏa thuận; khi chấm dứt hợp đồng phải xoá, huỷ, trừ khi có thỏa thuận hoặc luật quy định khác. **Đ12 BLLĐ và Đ3 NĐ 145:** người sử dụng lao động phải lập và cập nhật sổ quản lý lao động, trong đó có ngày và lý do chấm dứt hợp đồng. **Thời hạn giữ cụ thể: chưa xác minh.** |
| Tác động | Giữ mọi trường mãi mãi có thể trái Đ25.2. Ngược lại, tự xoá khi nghỉ việc có thể làm mất dữ liệu phải giữ cho nghĩa vụ lao động, BHXH hoặc thuế. |
| Đã làm | Lịch sử nghiệp vụ tách khỏi payload cá nhân. Audit không chứa giá trị hồ sơ. Không có API xoá hàng loạt. Role ứng dụng không xoá được hồ sơ. Idempotency chỉ lưu HMAC. |
| Phương án | (a) **Khuyến nghị:** lập lịch lưu giữ theo nhóm dữ liệu kèm căn cứ (lao động, BHXH, thuế, kế toán), có luật sư xác nhận, rồi xây quy trình ẩn danh/xoá theo lịch có duyệt. (b) Ghi điều khoản lưu giữ vào HĐLĐ hoặc nội quy; vẫn phải có căn cứ và giới hạn. (c) Giữ hết cho tới khi có chính sách: **không khuyến nghị** với dữ liệu thật. |
| Cần chốt | Người chịu trách nhiệm và luật sư xác nhận lịch lưu giữ **trước khi nhập dữ liệu thật**. Không chặn phát triển local. |

### PL-02 — RỦI RO PHÁP LÝ — CAO: đưa dữ liệu thật lên cloud/AI hoặc nhà cung cấp chưa đánh giá

| Hạng mục | Nội dung |
|---|---|
| Căn cứ / độ chắc chắn | **Đ30 Luật 91** (dữ liệu lớn, AI, điện toán đám mây): xử lý đúng mục đích, trong phạm vi cần thiết, có bảo mật, xác thực và phân quyền. **Đ12 NĐ 356** (theo lượt tra cứu): hợp đồng với nhà cung cấp cloud phải có các điều khoản bắt buộc, và dữ liệu phải được mã hoá khi lưu và khi truyền. Cần luật sư đọc lại nguyên văn. **Đ20.6.b Luật 91** chỉ miễn *đánh giá tác động chuyển dữ liệu xuyên biên giới* khi doanh nghiệp lưu dữ liệu người lao động của mình trên cloud. Đây không phải miễn mọi nghĩa vụ, và không áp dụng cho việc đưa dữ liệu vào AI. |
| Tác động | Bản hiện tại **chưa** mã hoá dữ liệu ở mức ứng dụng; DB local không mã hoá ổ đĩa. Chưa chọn hosting. |
| Đã làm | Chỉ dùng dữ liệu tổng hợp. Không gửi dữ liệu ra dịch vụ ngoài. Trang tài liệu API đã tắt telemetry, font CDN, proxy và AI agent (đã kiểm tra network: chỉ có request localhost). Log lỗi không ghi payload hay token. |
| Phương án | (a) **Khuyến nghị:** trước pilot, lập sơ đồ luồng dữ liệu và danh sách nhà cung cấp (hosting, sao lưu, email, giám sát lỗi); bật mã hoá khi lưu và TLS; có hợp đồng xử lý dữ liệu. (b) Pilot on-premise; vẫn cần mã hoá và kiểm soát truy cập. |
| Cần chốt | Hosting và nhà cung cấp trước pilot. Không bao giờ đưa hồ sơ thật vào công cụ AI. |

### PL-03 — RỦI RO PHÁP LÝ — TRUNG BÌNH (sẽ thành CAO nếu bật thêm nhóm dữ liệu): mở rộng thu thập theo toàn bộ template Excel

| Hạng mục | Nội dung |
|---|---|
| Căn cứ / độ chắc chắn | **Đ4 NĐ 356** (đã đối chiếu): **tình trạng sức khoẻ**, **ảnh chụp CCCD/CMND**, thông tin thẻ và đăng nhập ngân hàng, lịch sử giao dịch là dữ liệu **nhạy cảm**. *Số* CCCD là dữ liệu cơ bản (Đ3). Dữ liệu trẻ em có quy tắc riêng (Đ24 Luật 91, theo lượt tra cứu). Template có các cột "Heathy certification", "ID card", con và người phụ thuộc, ngân hàng. |
| Tác động | Bật các nhóm này kéo theo nghĩa vụ cao hơn, và có thể làm mất ngoại lệ ở Đ41 NĐ 356 (xem PL-04). |
| Đã làm | API trả `422 PROTECTED_FIELD_NOT_ENABLED` cho các nhóm này. Không có quyền `employees.read_sensitive` cho bất kỳ role nào. |
| Phương án | (a) **Khuyến nghị:** chỉ bật từng nhóm khi có nhu cầu nghiệp vụ, căn cứ, mã hoá, chỉ mục tra trùng HMAC, quyền riêng và thời hạn lưu. (b) Lưu giấy tờ và sức khoẻ ở hệ chuyên dụng, HRMS chỉ giữ trạng thái "đã nộp". |
| Cần chốt | Trước khi bật mỗi nhóm. Không dùng ô "đồng ý tất cả" làm giải pháp mặc định (Đ9 Luật 91 yêu cầu đồng ý riêng cho từng mục đích). |

### PL-04 — RỦI RO PHÁP LÝ — TRUNG BÌNH: tự cho rằng được miễn đánh giá tác động

| Hạng mục | Nội dung |
|---|---|
| Căn cứ / độ chắc chắn | **Đ41 NĐ 356** (đã đối chiếu): doanh nghiệp nhỏ và khởi nghiệp được chọn chưa thực hiện Đ21, Đ22 và khoản 2 Đ33 Luật 91 trong 5 năm. **Không áp dụng** nếu trực tiếp xử lý dữ liệu nhạy cảm, kinh doanh dịch vụ xử lý dữ liệu, hoặc xử lý dữ liệu từ 100.000 người trở lên. Hồ sơ đánh giá tác động lập từ khi bắt đầu xử lý và nộp trong 60 ngày (Đ19–20 NĐ 356, theo lượt tra cứu). **Chưa xác minh** công ty 100–300 lao động có thuộc nhóm "nhỏ" theo tiêu chí doanh nghiệp nhỏ và vừa hiện hành hay không. |
| Tác động | Nếu không thuộc diện miễn mà không lập hồ sơ thì có rủi ro tuân thủ khi bắt đầu xử lý dữ liệu thật. |
| Phương án | (a) **Khuyến nghị:** luật sư xác định diện áp dụng; nếu phải lập hồ sơ thì chuẩn bị song song với pilot, dùng ADR và bảng mục 2 làm đầu vào. (b) Tự xác định: không khuyến nghị. |
| Cần chốt | Trước khi xử lý dữ liệu thật. |

### PL-05 — RỦI RO PHÁP LÝ — TRUNG BÌNH: căn cứ xử lý, thông báo và quyền của chủ thể dữ liệu

| Hạng mục | Nội dung |
|---|---|
| Căn cứ / độ chắc chắn | **Đ9 Luật 91** (đồng ý tự nguyện, riêng cho từng mục đích; im lặng không phải đồng ý). **Đ19.1** (các trường hợp không cần đồng ý, trong đó có thực hiện thỏa thuận theo luật). **Đ4, 10, 13, 14** (quyền được biết, sửa, xoá, rút đồng ý...). **Đ5 NĐ 356:** thời hạn phản hồi yêu cầu (theo lượt tra cứu: phản hồi trong 2 ngày làm việc; xem/sửa 10 ngày; xoá 20 ngày). Cần luật sư xác nhận. |
| Tác động | HRMS chưa có luồng để nhân viên xem, sửa hoặc yêu cầu xoá dữ liệu của mình. |
| Phương án | Trước pilot: lập bảng căn cứ cho từng trường, viết thông báo xử lý dữ liệu cho nhân viên, và thiết lập quy trình xử lý yêu cầu (thủ công qua HR là chấp nhận được ở bản đầu). |
| Cần chốt | Người phụ trách quy trình yêu cầu dữ liệu. |

### PL-06 — RỦI RO PHÁP LÝ — THẤP (hiện tại): coi HRMS là sổ quản lý lao động điện tử

**Căn cứ:** Đ12 BLLĐ và Đ3 NĐ 145 yêu cầu sổ có nhiều nội dung mà S0–S3 chưa có: CCCD, BHXH, lương, nâng bậc, ngày nghỉ, làm thêm, kỷ luật, tai nạn lao động, lý do chấm dứt.

**Khuyến nghị:** **không** tuyên bố HRMS đã đáp ứng nghĩa vụ sổ quản lý lao động. Nếu muốn HRMS đảm nhiệm vai trò này thì cần mở rộng phạm vi ở các giai đoạn sau và có luật sư rà soát.

## 4. Việc phải xong trước khi dùng dữ liệu thật (pilot)

1. Có lịch lưu giữ theo nhóm dữ liệu kèm căn cứ, có luật sư xác nhận (PL-01).
2. Đã chọn hosting và nhà cung cấp; có mã hoá khi lưu và khi truyền; có hợp đồng xử lý dữ liệu (PL-02).
3. Đã xác định diện áp dụng đánh giá tác động, người phụ trách, và hồ sơ nếu phải lập (PL-04).
4. Có bảng căn cứ xử lý cho từng trường, thông báo cho nhân viên, quy trình xử lý yêu cầu (PL-05).
5. Đăng nhập Entra thật thay cho test issuer. `APP_ENV=production` và `AUTH_TEST_ISSUER_ENABLED` không bật.
6. Không ghi log query chứa từ khoá tìm kiếm ở proxy hay access log (xem rủi ro kỹ thuật trong README).
