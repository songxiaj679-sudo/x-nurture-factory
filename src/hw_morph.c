#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <unistd.h>

long sysconf(int name) {
    static long (*real_sysconf)(int) = NULL;
    if (!real_sysconf) real_sysconf = dlsym(RTLD_NEXT, "sysconf");
    if (name == _SC_NPROCESSORS_ONLN || name == _SC_NPROCESSORS_CONF) {
        const char* c = getenv("MORPH_CORES");
        if (c) {
            long val = atol(c);
            if (val > 0) return val;
        }
    }
    return real_sysconf ? real_sysconf(name) : 8;
}
