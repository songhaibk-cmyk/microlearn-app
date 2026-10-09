# MicroLearn Vật lý 10

Ứng dụng học tập vi mô cho học sinh, giáo viên và quản trị viên trường. Frontend React/Vite có thể chạy trên Vercel hoặc Netlify; Supabase cung cấp tài khoản, PostgreSQL và phân quyền theo trường/lớp.

## Tính năng đã có

- Đăng ký, đăng nhập email/mật khẩu và khôi phục phiên đăng nhập bằng Supabase Auth.
- Tạo trường; người tạo trở thành quản trị viên trường đầu tiên.
- Quản trị viên cấp mã mời giáo viên, phân công nhiều giáo viên vào một lớp và tạo nhiều lớp.
- Giáo viên tạo lớp, chia sẻ mã tham gia cho học sinh, giao nhiệm vụ và xem kết quả của lớp được phân công.
- Học sinh tham gia lớp bằng mã, làm nhiệm vụ và xem phản hồi sau khi nộp.
- PostgreSQL Row Level Security giới hạn dữ liệu theo trường, lớp và vai trò. Đáp án được lưu tách biệt và chấm qua RPC ở cơ sở dữ liệu.

## 1. Tạo Supabase project

1. Tạo một project mới trên Supabase.
2. Mở **SQL Editor**, dán và chạy `supabase/migrations/20261009_initial_schema.sql`.
3. Trong **Project Settings → API**, lấy Project URL và publishable/anon key. Không dùng `service_role` key ở frontend.
4. Trong **Authentication → URL Configuration**, đặt Site URL thành địa chỉ ứng dụng và thêm URL preview/development vào Redirect URLs.
5. Có thể bật xác nhận email trong Auth. Khi bật, người dùng phải xác nhận email trước khi đăng nhập.

## 2. Chạy tại máy

Yêu cầu Node.js 22.12 trở lên.

```sh
pnpm install
Copy-Item .env.example .env.local
```

Điền hai biến vào `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Sau đó chạy:

```sh
pnpm dev
```

Tạo tài khoản tại trang đăng nhập. Người tạo trường sẽ trở thành quản trị viên; quản trị viên có thể gửi mã mời cho giáo viên. Giáo viên có thể tạo lớp, và học sinh đăng ký tài khoản rồi nhập mã của lớp.

## 3. Xuất bản lên Vercel

1. Đưa thư mục này lên GitHub hoặc kết nối repository chứa nó.
2. Chọn `microlearn-app` làm Root Directory nếu repository chứa thư mục dự án này.
3. Build command: `pnpm build`; Output Directory: `dist`.
4. Thêm `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` trong Project Settings → Environment Variables cho các môi trường cần dùng.
5. Deploy lại sau khi thêm biến môi trường.

`vercel.json` đã cấu hình chuyển các đường dẫn SPA về `index.html`.

## 4. Xuất bản lên Netlify

1. Kết nối repository và đặt Base directory là `microlearn-app` (hoặc thư mục này nếu đã tách riêng).
2. Lệnh build: `pnpm build`; thư mục publish: `dist`.
3. Thêm hai biến môi trường Supabase trong Site configuration → Environment variables.
4. Deploy và thêm URL của site vào Supabase Auth Redirect URLs.

`netlify.toml` đã cấu hình build và fallback SPA.

## Mô hình quyền

- `school_admin`: quản lý các lớp, mã mời giáo viên và phân công giáo viên trong trường.
- `teacher`: xem lớp được phân công, tạo nhiệm vụ và xem bài nộp của học sinh trong những lớp đó.
- `student`: chỉ xem lớp đã tham gia, nhiệm vụ của các lớp đó và lượt làm của chính mình.

Các RPC đổi mã mời thành vai trò đều xác minh ở PostgreSQL. Mọi bảng chứa dữ liệu ứng dụng bật RLS. Không thay các policy bằng quyền truy cập công khai.

## Giới hạn của bản hiện tại

- Bản này tập trung vào luồng lớp học, tài khoản, nhiệm vụ trắc nghiệm một câu và báo cáo lượt nộp. Chưa chuyển toàn bộ các màn hình đề thi, quản trị nội dung, quét ảnh/OCR và báo cáo chuyên sâu của prototype cũ sang Supabase.
- Đây là bản đầu để thử nghiệm trong một lớp. Trước khi đưa dữ liệu thật của học sinh vào, cần kiểm tra lại migration/RLS trên project riêng, xác nhận quy trình đồng ý và lưu trữ dữ liệu của trường, và thử nghiệm luồng quyền với tài khoản học sinh/giáo viên/quản trị viên riêng biệt.
- Không dùng bài tập hiện tại như bài kiểm tra có tính quyết định cao. Nhiệm vụ đang chấm câu trả lời đơn giản ở server; chưa có bộ kiểm thử nội dung, lưu trữ phiên bản đề hay quy trình phúc khảo.
