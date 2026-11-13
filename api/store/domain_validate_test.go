package store

import (
	"strings"
	"testing"
)

func TestValidateDomain(t *testing.T) {
	valid := []string{
		"example.com",
		"Example.COM",
		"example.com.",
		" example.com\n", // 首尾空白会被规整化去掉
		"*.example.com",
		"sub.example.co.uk",
		"a-b.example.com",
		"a.io",
		"xn--fiq228c.com",
		"1password.com",
		strings.Repeat("a", 63) + ".com",
	}
	for _, domain := range valid {
		t.Run("valid/"+domain, func(t *testing.T) {
			if err := ValidateDomain(domain); err != nil {
				t.Fatalf("ValidateDomain(%q) = %v, want nil", domain, err)
			}
		})
	}

	longName := strings.Repeat("a.", 130) + "com" // 超过 253 个字符
	invalid := []string{
		"",
		"   ",
		".",
		"*.",
		"localhost",
		"com",
		"1.2.3.4",
		"example.123",
		"exa mple.com",
		"example..com",
		".example.com",
		"-bad.com",
		"bad-.com",
		"under_score.com",
		"example.com/path",
		"http://example.com",
		"user@example.com",
		"example.com:25",
		"*.*.example.com",
		"*example.com",
		"a.*.example.com",
		"例子.com",
		"example.com\r\nRCPT TO:<x@y>",
		"/^.*$/",
		strings.Repeat("a", 64) + ".com",
		longName,
	}
	for _, domain := range invalid {
		t.Run("invalid/"+strings.TrimSpace(domain), func(t *testing.T) {
			if err := ValidateDomain(domain); err == nil {
				t.Fatalf("ValidateDomain(%q) = nil, want error", domain)
			}
		})
	}
}
