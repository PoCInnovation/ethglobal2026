#pragma once

#include <stdbool.h>
#include "buffer.h"

bool auth_parse_payload(const buffer_t *buf);
