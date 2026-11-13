package main

import (
	"encoding/base64"
	"fmt"
	"net/mail"
	"strings"
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

// 这组测试覆盖「正文解码」：Content-Transfer-Encoding（base64 / quoted-printable）
// 与 charset（GBK / Big5 / Shift_JIS 等）。此前这两项都没处理，
// 导致 Gmail 转发等 base64 邮件在阅读器里显示成一整段 base64 原文。

func parseBodies(t *testing.T, raw string) (text, html string) {
	t.Helper()
	msg, err := mail.ReadMessage(strings.NewReader(strings.ReplaceAll(raw, "\n", "\r\n")))
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	return extractBodies(msg)
}

// wrap76 把 base64 文本按 76 列折行（MIME 规定的格式）。
func wrap76(s string) string {
	var b strings.Builder
	for len(s) > 76 {
		b.WriteString(s[:76] + "\n")
		s = s[76:]
	}
	b.WriteString(s)
	return b.String()
}

func b64(s string) string { return wrap76(base64.StdEncoding.EncodeToString([]byte(s))) }

func mustGBK(t *testing.T, s string) string {
	t.Helper()
	out, err := simplifiedchinese.GBK.NewEncoder().String(s)
	if err != nil {
		t.Fatalf("encode gbk: %v", err)
	}
	return out
}

// qpEncode 把任意字节串编码成 quoted-printable（每个非 ASCII 字节写成 =XX）。
func qpEncode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 0x80 || c == '=' {
			fmt.Fprintf(&b, "=%02X", c)
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

const (
	zhText = "您的登录验证码是 482915，10 分钟内有效。"
	zhHTML = `<div style="color:#c0392b">您的登录验证码是 <b>482915</b></div>`
)

func TestExtractBodiesSinglePart(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		wantText string
		wantHTML string
	}{
		{
			name:     "7bit 纯文本保持原样",
			raw:      "Content-Type: text/plain; charset=us-ascii\nContent-Transfer-Encoding: 7bit\n\nhello world\n",
			wantText: "hello world\r\n",
		},
		{
			name:     "8bit UTF-8 保持原样",
			raw:      "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n" + zhText + "\n",
			wantText: zhText + "\r\n",
		},
		{
			name:     "没有任何编码头的纯文本",
			raw:      "Subject: x\n\nplain body\n",
			wantText: "plain body\r\n",
		},
		{
			name:     "base64 的 text/html（Gmail 转发的情形）",
			raw:      "Content-Type: text/html; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n" + b64(zhHTML) + "\n",
			wantHTML: zhHTML,
		},
		{
			name:     "base64 的 text/plain",
			raw:      "Content-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n" + b64(zhText) + "\n",
			wantText: zhText,
		},
		{
			name:     "编码头大小写与空白不敏感",
			raw:      "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding:   BASE64  \n\n" + b64(zhText) + "\n",
			wantText: zhText,
		},
		{
			name:     "quoted-printable 的 UTF-8",
			raw:      "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n" + qpEncode("你好，世界 a=b") + "\n",
			wantText: "你好，世界 a=b\r\n",
		},
		{
			name:     "GBK + base64",
			raw:      "Content-Type: text/plain; charset=gbk\nContent-Transfer-Encoding: base64\n\n" + b64(mustGBK(t, zhText)) + "\n",
			wantText: zhText,
		},
		{
			name:     "gb2312 标签按 GBK 解码 + quoted-printable",
			raw:      "Content-Type: text/html; charset=\"gb2312\"\nContent-Transfer-Encoding: quoted-printable\n\n" + qpEncode(mustGBK(t, zhHTML)) + "\n",
			wantHTML: zhHTML + "\r\n",
		},
		{
			name:     "非标准字符集别名 euc_cn / cp936",
			raw:      "Content-Type: text/plain; charset=cp936\nContent-Transfer-Encoding: base64\n\n" + b64(mustGBK(t, zhText)) + "\n",
			wantText: zhText,
		},
		{
			name:     "未编码的 8bit GBK 正文",
			raw:      "Content-Type: text/plain; charset=GB18030\nContent-Transfer-Encoding: 8bit\n\n" + mustGBK(t, zhText) + "\n",
			wantText: zhText + "\r\n",
		},
		{
			name:     "base64 缺少填充、含空格与多余换行",
			raw:      "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n" + strings.TrimRight(strings.ReplaceAll(b64(zhText), "\n", " \n\n"), "=") + "\n",
			wantText: zhText,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotText, gotHTML := parseBodies(t, tt.raw)
			if gotText != tt.wantText {
				t.Errorf("text = %q, want %q", gotText, tt.wantText)
			}
			if gotHTML != tt.wantHTML {
				t.Errorf("html = %q, want %q", gotHTML, tt.wantHTML)
			}
		})
	}
}

func TestExtractBodiesMultipart(t *testing.T) {
	const b = "BOUNDARY-123"

	alt := func(textPart, htmlPart string) string {
		return "Content-Type: multipart/alternative; boundary=\"" + b + "\"\n\n" +
			"--" + b + "\n" + textPart + "\n--" + b + "\n" + htmlPart + "\n--" + b + "--\n"
	}

	t.Run("Gmail 风格 multipart/alternative，两部分都是 base64", func(t *testing.T) {
		raw := alt(
			"Content-Type: text/plain; charset=\"UTF-8\"\nContent-Transfer-Encoding: base64\n\n"+b64(zhText)+"\n",
			"Content-Type: text/html; charset=\"UTF-8\"\nContent-Transfer-Encoding: base64\n\n"+b64(zhHTML)+"\n",
		)
		text, html := parseBodies(t, raw)
		if strings.TrimSpace(text) != zhText {
			t.Errorf("text = %q, want %q", text, zhText)
		}
		if strings.TrimSpace(html) != zhHTML {
			t.Errorf("html = %q, want %q", html, zhHTML)
		}
	})

	t.Run("quoted-printable 只解码一次", func(t *testing.T) {
		// 解码后的正文里含有「=41」字样：如果被重复解码，会变成 "A"。
		src := "代码 =41 保持原样"
		raw := alt(
			"Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n"+qpEncode(src)+"\n",
			"Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n"+qpEncode("<p>"+src+"</p>")+"\n",
		)
		text, html := parseBodies(t, raw)
		if strings.TrimSpace(text) != src {
			t.Errorf("text = %q, want %q", text, src)
		}
		if strings.TrimSpace(html) != "<p>"+src+"</p>" {
			t.Errorf("html = %q", html)
		}
	})

	t.Run("GBK 的 text 与 html，分别使用 base64 与 quoted-printable", func(t *testing.T) {
		raw := alt(
			"Content-Type: text/plain; charset=gb2312\nContent-Transfer-Encoding: base64\n\n"+b64(mustGBK(t, zhText))+"\n",
			"Content-Type: text/html; charset=gbk\nContent-Transfer-Encoding: quoted-printable\n\n"+qpEncode(mustGBK(t, zhHTML))+"\n",
		)
		text, html := parseBodies(t, raw)
		if strings.TrimSpace(text) != zhText {
			t.Errorf("text = %q, want %q", text, zhText)
		}
		if strings.TrimSpace(html) != zhHTML {
			t.Errorf("html = %q, want %q", html, zhHTML)
		}
	})

	t.Run("嵌套 multipart/mixed 里的 multipart/alternative", func(t *testing.T) {
		const inner = "INNER-456"
		raw := "Content-Type: multipart/mixed; boundary=\"" + b + "\"\n\n" +
			"--" + b + "\n" +
			"Content-Type: multipart/alternative; boundary=\"" + inner + "\"\n\n" +
			"--" + inner + "\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n" + b64(zhText) + "\n" +
			"--" + inner + "\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n" + b64(zhHTML) + "\n" +
			"--" + inner + "--\n" +
			"--" + b + "\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\n\nJVBERi0xLjQK\n" +
			"--" + b + "--\n"
		text, html := parseBodies(t, raw)
		if strings.TrimSpace(text) != zhText || strings.TrimSpace(html) != zhHTML {
			t.Errorf("text = %q, html = %q", text, html)
		}
	})

	t.Run("Big5 与 Shift_JIS", func(t *testing.T) {
		big5, err := traditionalchinese.Big5.NewEncoder().String("繁體中文驗證碼")
		if err != nil {
			t.Fatal(err)
		}
		sjis, err := japanese.ShiftJIS.NewEncoder().String("確認コード")
		if err != nil {
			t.Fatal(err)
		}
		raw := alt(
			"Content-Type: text/plain; charset=big5\nContent-Transfer-Encoding: base64\n\n"+b64(big5)+"\n",
			"Content-Type: text/html; charset=shift_jis\nContent-Transfer-Encoding: base64\n\n"+b64(sjis)+"\n",
		)
		text, html := parseBodies(t, raw)
		if strings.TrimSpace(text) != "繁體中文驗證碼" || strings.TrimSpace(html) != "確認コード" {
			t.Errorf("text = %q, html = %q", text, html)
		}
	})
}

func TestExtractBodiesGuardsAgainstBinaryData(t *testing.T) {
	// 单部分的非文本邮件没有可显示的正文：不能把二进制按文本解码后塞进数据库。
	pdf := "Content-Type: application/pdf\nContent-Transfer-Encoding: base64\n\n" + b64("%PDF-1.4\x00\x01\x02binary") + "\n"
	if text, html := parseBodies(t, pdf); text != "" || html != "" {
		t.Errorf("non-text single part should have no body, got text=%q html=%q", text, html)
	}

	// 解码后出现 NUL（PostgreSQL 的 TEXT 不接受）：必须去掉，否则整封邮件会入库失败并被反复重试。
	nul := "Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n" + b64("a\x00b\x00c") + "\n"
	if text, _ := parseBodies(t, nul); text != "abc" {
		t.Errorf("NUL bytes should be stripped, got %q", text)
	}
}

func TestExtractBodiesNeverProducesInvalidUTF8(t *testing.T) {
	// 不认识的字符集 / 声明与实际不符的字节：不能 panic，结果必须是合法 UTF-8，
	// 否则 JSON/PostgreSQL 这条链路会出问题。
	raws := []string{
		"Content-Type: text/plain; charset=x-no-such-charset\nContent-Transfer-Encoding: 8bit\n\n\xff\xfe broken \x80\n",
		"Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n\xc4\xe3\xba\xc3\n",
		"Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n!!!not base64!!!\n",
		"Content-Type: text/plain\nContent-Transfer-Encoding: base64\n\n\n",
		"Content-Type: text/plain\nContent-Transfer-Encoding: x-weird\n\nbody\n",
	}
	for i, raw := range raws {
		text, html := parseBodies(t, raw)
		if !utf8.ValidString(text) || !utf8.ValidString(html) {
			t.Errorf("case %d: invalid UTF-8 in result: %q / %q", i, text, html)
		}
	}
}

func TestDecodeHeaderCharsets(t *testing.T) {
	gbkWord := base64.StdEncoding.EncodeToString([]byte(mustGBK(t, "验证码")))
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"GBK 的 B 编码主题", "=?GBK?B?" + gbkWord + "?=", "验证码"},
		{"gb2312 的 Q 编码主题", "=?gb2312?Q?" + strings.ReplaceAll(qpEncode(mustGBK(t, "你好")), " ", "_") + "?=", "你好"},
		{"GBK 显示名 + 地址", "=?GB18030?B?" + gbkWord + "?= <noreply@example.com>", "验证码 <noreply@example.com>"},
		// Python 的 email 库会把 gb2312 写成 eucgb2312_cn，线上验证中真实出现过。
		{"Python 风格别名 eucgb2312_cn", "=?eucgb2312_cn?b?" + gbkWord + "?=", "验证码"},
		{"Windows 风格别名 cp936", "=?cp936?B?" + gbkWord + "?=", "验证码"},
		{"x-gbk 前缀写法", "=?x-gbk?B?" + gbkWord + "?=", "验证码"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decodeHeader(tt.in); got != tt.want {
				t.Fatalf("decodeHeader(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
